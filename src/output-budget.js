import { TextRetainer, describeOmitted } from '@deepseek-ai/dsh-output-retention';

export const name = 'dsh-output-budget';
export const inject = ['tools'];

const MIN_INLINE_BYTES = 512;
const MAX_INLINE_BYTES = 4 * 1024 * 1024;

export const DEFAULT_OUTPUT_BUDGET_CONFIG = Object.freeze({
  defaultMaxInlineBytes: 16 * 1024,
  toolMaxInlineBytes: Object.freeze({
    bash: 12 * 1024,
    pwsh: 12 * 1024,
    grep: 12 * 1024,
    glob: 12 * 1024,
    web: 16 * 1024,
    subagent: 24 * 1024,
    subagent_fork: 24 * 1024,
  }),
  skipTools: Object.freeze(['read', 'skillopt']),
});

function inlineBudget(value, label) {
  if (!Number.isInteger(value) || value < MIN_INLINE_BYTES || value > MAX_INLINE_BYTES) {
    throw new RangeError(`${label} must be an integer from ${MIN_INLINE_BYTES} to ${MAX_INLINE_BYTES}`);
  }
  return value;
}

function toolName(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9_.:-]+$/u.test(normalized)) {
    throw new TypeError(`${label} must be a non-empty DSH tool name`);
  }
  return normalized;
}

export function resolveOutputBudgetConfig(rawConfig = {}) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new TypeError('output-budget config must be an object');
  }
  const allowed = new Set(['defaultMaxInlineBytes', 'toolMaxInlineBytes', 'skipTools']);
  for (const key of Object.keys(rawConfig)) {
    if (!allowed.has(key)) throw new Error(`output-budget: unknown config key ${JSON.stringify(key)}`);
  }

  const rawToolBudgets = rawConfig.toolMaxInlineBytes ?? {};
  if (!rawToolBudgets || typeof rawToolBudgets !== 'object' || Array.isArray(rawToolBudgets)) {
    throw new TypeError('toolMaxInlineBytes must be an object keyed by tool name');
  }
  const toolMaxInlineBytes = { ...DEFAULT_OUTPUT_BUDGET_CONFIG.toolMaxInlineBytes };
  for (const [rawName, value] of Object.entries(rawToolBudgets)) {
    const normalizedName = toolName(rawName, 'toolMaxInlineBytes key');
    toolMaxInlineBytes[normalizedName] = inlineBudget(value, `toolMaxInlineBytes.${normalizedName}`);
  }

  const rawSkipTools = rawConfig.skipTools ?? DEFAULT_OUTPUT_BUDGET_CONFIG.skipTools;
  if (!Array.isArray(rawSkipTools)) throw new TypeError('skipTools must be an array');
  const skipTools = [...new Set(rawSkipTools.map((value) => toolName(value, 'skipTools entry')))].sort();

  return Object.freeze({
    defaultMaxInlineBytes: inlineBudget(
      rawConfig.defaultMaxInlineBytes ?? DEFAULT_OUTPUT_BUDGET_CONFIG.defaultMaxInlineBytes,
      'defaultMaxInlineBytes',
    ),
    toolMaxInlineBytes: Object.freeze(toolMaxInlineBytes),
    skipTools: Object.freeze(skipTools),
  });
}

export function flattenPlainText(content) {
  let text = '';
  for (const block of content) {
    if (block.type !== 'text') return undefined;
    text += block.text;
  }
  return text;
}

function ownerSessionId(exec) {
  return exec.agent?.session.header.id;
}

function retainPreview(text, budget) {
  const retainer = new TextRetainer({
    kind: 'headTail',
    headBytes: Math.ceil(budget / 2),
    tailBytes: Math.floor(budget / 2),
  });
  retainer.push(text);
  return retainer.finish();
}

function spillNotice(tool, omitted, ref) {
  return [
    'status: warning',
    `summary: ${tool} output exceeded its inline budget; ${describeOmitted(omitted, 'bytes')}`,
    `next_actions: ${ref.retrievalHint}`,
    `artifacts: ${ref.locator}`,
  ].join('\n');
}

function replacementWithinBudget(text, tool, ref, cap, totalBytes) {
  const worstCaseNotice = spillNotice(tool, { kind: 'exact', count: totalBytes }, ref);
  const reservedBytes = Buffer.byteLength(worstCaseNotice, 'utf8') + 2;
  const kept = retainPreview(text, Math.max(0, cap - reservedBytes));
  const notice = spillNotice(tool, kept.omittedBytes, ref);
  const replacement = kept.text.length > 0 ? `${kept.text}\n\n${notice}` : notice;
  return Buffer.byteLength(replacement, 'utf8') <= cap ? replacement : undefined;
}

export function createOutputBudgetPolicy(ctx, rawConfig = {}) {
  const config = resolveOutputBudgetConfig(rawConfig);
  const skipTools = new Set(config.skipTools);

  function budgetFor(tool) {
    return config.toolMaxInlineBytes[tool] ?? config.defaultMaxInlineBytes;
  }

  async function spill(text, exec, tool, callId, label) {
    const sessionId = ownerSessionId(exec);
    if (sessionId === undefined) {
      ctx.logger.warn(`output-budget: no session owner for ${tool} ${label}; keeping inline content`);
      return undefined;
    }
    const spillStore = ctx.get('spillStore');
    if (!spillStore) {
      ctx.logger.warn('output-budget: ctx.spillStore is unavailable; keeping inline content');
      return undefined;
    }

    let ref;
    try {
      ref = await spillStore.saveText({
        owner: { sessionId },
        source: { toolName: tool, callId, label },
        suggestedName: `${tool}.txt`,
        content: text,
      });
    } catch (error) {
      ctx.logger.warn(`output-budget: saveText failed for ${tool}: ${String(error)}; keeping inline content`);
      return undefined;
    }

    const cap = budgetFor(tool);
    const replacement = replacementWithinBudget(
      text,
      tool,
      ref,
      cap,
      Buffer.byteLength(text, 'utf8'),
    );
    if (replacement === undefined) {
      ctx.logger.warn(`output-budget: artifact notice for ${tool} exceeds ${cap} bytes; keeping inline content`);
    }
    return replacement;
  }

  async function postExecute(exec, result, next) {
    const decision = await next();
    if (
      decision.kind !== 'accept'
      || Object.hasOwn(decision, 'value')
      || exec.parent !== undefined
      || skipTools.has(exec.name)
    ) return decision;

    const content = decision.content ?? result.content;
    const text = flattenPlainText(content);
    if (text === undefined || Buffer.byteLength(text, 'utf8') <= budgetFor(exec.name)) return decision;
    const replacement = await spill(text, exec, exec.name, exec.callId, 'budget-result');
    if (replacement === undefined) return decision;
    return {
      kind: 'accept',
      content: [{ type: 'text', text: replacement }],
      ...(decision.additionalContexts ? { additionalContexts: decision.additionalContexts } : {}),
    };
  }

  async function codeDispatchLog(dispatch, next) {
    const content = await next();
    const text = flattenPlainText(content);
    if (text === undefined || Buffer.byteLength(text, 'utf8') <= budgetFor(dispatch.name)) return content;
    const replacement = await spill(
      text,
      dispatch.exec,
      dispatch.name,
      dispatch.subCallId,
      'budget-dispatch',
    );
    return replacement === undefined ? content : [{ type: 'text', text: replacement }];
  }

  return Object.freeze({ config, budgetFor, postExecute, codeDispatchLog });
}

export function apply(ctx, config = {}) {
  const policy = createOutputBudgetPolicy(ctx, config);
  ctx.on('tools/post-execute', policy.postExecute, { prepend: true });
  ctx.on('tools/code-dispatch-log', policy.codeDispatchLog, { prepend: true });
}
