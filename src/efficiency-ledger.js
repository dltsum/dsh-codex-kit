import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const name = 'dsh-efficiency-ledger';
export const inject = ['agents', 'llm', 'tools'];
export const LEDGER_SCHEMA = 'dsh-codex-kit/efficiency-ledger/v1';

const DEFAULT_MAX_PENDING_RECORDS = 4096;

export function defaultLedgerRoot(environment = process.env) {
  const dshHome = resolve(environment.DSH_HOME || join(homedir(), '.dsh'));
  return join(dshHome, 'metrics', 'dsh-codex-kit');
}

export function resolveLedgerConfig(rawConfig = {}, environment = process.env) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new TypeError('efficiency-ledger config must be an object');
  }
  const allowed = new Set(['root', 'maxPendingRecords']);
  for (const key of Object.keys(rawConfig)) {
    if (!allowed.has(key)) throw new Error(`efficiency-ledger: unknown config key ${JSON.stringify(key)}`);
  }
  const root = resolve(rawConfig.root || defaultLedgerRoot(environment));
  const maxPendingRecords = Number(rawConfig.maxPendingRecords ?? DEFAULT_MAX_PENDING_RECORDS);
  if (!Number.isInteger(maxPendingRecords) || maxPendingRecords < 64 || maxPendingRecords > 100000) {
    throw new RangeError('maxPendingRecords must be an integer from 64 to 100000');
  }
  return Object.freeze({ root, maxPendingRecords });
}

function safeFileTime(date = new Date()) {
  return date.toISOString().replace(/[:.]/gu, '-');
}

export function stableHash(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function jsonBytes(value) {
  try {
    const rendered = JSON.stringify(value);
    return rendered === undefined ? 0 : Buffer.byteLength(rendered, 'utf8');
  } catch {
    return undefined;
  }
}

function contentBytes(content) {
  let total = 0;
  for (const block of content ?? []) {
    if (block?.type === 'text') total += Buffer.byteLength(String(block.text ?? ''), 'utf8');
    else {
      const bytes = jsonBytes(block);
      if (bytes !== undefined) total += bytes;
    }
  }
  return total;
}

function safeError(error) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const code = typeof normalized.code === 'string' && normalized.code.length <= 80
    ? normalized.code
    : undefined;
  return { error_name: normalized.name, ...(code ? { error_code: code } : {}) };
}

function usageFields(usage) {
  if (!usage || typeof usage !== 'object') return {};
  const fields = {};
  for (const key of [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
  ]) {
    const value = usage[key];
    if (Number.isFinite(value) && value >= 0) fields[key] = value;
  }
  return fields;
}

function sessionFields(session) {
  return {
    session_hash: stableHash(session?.header?.id ?? session?.id),
    workspace_hash: stableHash(session?.header?.cwd),
  };
}

function agentFields(agent) {
  return sessionFields(agent?.session);
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export class AppendOnlyEfficiencyLedger {
  #closed = false;
  #dropped = 0;
  #lastError;
  #pending = Promise.resolve();
  #pendingRecords = 0;
  #sequence = 0;

  constructor(config, logger = console) {
    this.config = resolveLedgerConfig(config);
    this.logger = logger;
    this.runId = randomUUID();
    mkdirSync(this.config.root, { recursive: true, mode: 0o700 });
    this.path = join(
      this.config.root,
      `run-${safeFileTime()}-${process.pid}-${this.runId.slice(0, 8)}.jsonl`,
    );
    writeFileSync(this.path, `${JSON.stringify({
      schema: LEDGER_SCHEMA,
      kind: 'run_start',
      seq: this.#sequence++,
      time: Date.now(),
      run_id: this.runId,
      process_id: process.pid,
      node_version: process.versions.node,
      platform: process.platform,
      content_policy: 'numeric-and-enum-metadata-only',
    })}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }

  get droppedRecords() {
    return this.#dropped;
  }

  get lastError() {
    return this.#lastError;
  }

  record(value) {
    if (this.#closed) return false;
    if (this.#pendingRecords >= this.config.maxPendingRecords) {
      this.#dropped += 1;
      return false;
    }
    const line = `${JSON.stringify(compactObject({
      ...value,
      schema: LEDGER_SCHEMA,
      seq: this.#sequence++,
      time: Date.now(),
    }))}\n`;
    this.#pendingRecords += 1;
    this.#pending = this.#pending
      .then(() => new Promise((resolveWrite, rejectWrite) => {
        appendFile(this.path, line, { encoding: 'utf8' }, (error) => {
          if (error) rejectWrite(error);
          else resolveWrite();
        });
      }))
      .catch((error) => {
        this.#lastError = error;
        this.logger.warn(`efficiency-ledger: append failed (${error instanceof Error ? error.name : 'Error'})`);
      })
      .finally(() => {
        this.#pendingRecords -= 1;
      });
    return true;
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#pending;
    const finalRecords = [];
    if (this.#dropped > 0) {
      finalRecords.push({
        schema: LEDGER_SCHEMA,
        kind: 'ledger_drop',
        seq: this.#sequence++,
        time: Date.now(),
        dropped_records: this.#dropped,
      });
    }
    finalRecords.push({
      schema: LEDGER_SCHEMA,
      kind: 'run_end',
      seq: this.#sequence++,
      time: Date.now(),
      status: this.#lastError ? 'warning' : 'success',
    });
    try {
      await new Promise((resolveWrite, rejectWrite) => {
        appendFile(
          this.path,
          `${finalRecords.map((record) => JSON.stringify(record)).join('\n')}\n`,
          { encoding: 'utf8' },
          (error) => error ? rejectWrite(error) : resolveWrite(),
        );
      });
    } catch (error) {
      this.#lastError = error;
      this.logger.warn(`efficiency-ledger: final append failed (${error instanceof Error ? error.name : 'Error'})`);
    }
  }
}

function requestMetrics(options) {
  const toolSchemas = options.tools ?? [];
  return compactObject({
    provider: options.provider,
    model: options.model,
    purpose: options.purpose ?? 'conversation',
    session_hash: stableHash(options.sessionId),
    message_count: Array.isArray(options.messages) ? options.messages.length : 0,
    message_bytes: jsonBytes(options.messages ?? []),
    system_bytes: Buffer.byteLength(String(options.system ?? ''), 'utf8'),
    tool_count: Array.isArray(toolSchemas) ? toolSchemas.length : 0,
    tool_schema_bytes: jsonBytes(toolSchemas),
    requested_max_tokens: options.maxTokens,
  });
}

export function wrapLlmStream(options, next, ledger) {
  const started = performance.now();
  let source;
  try {
    source = next();
  } catch (error) {
    ledger.record({
      kind: 'llm_call',
      status: 'error',
      latency_ms: Number((performance.now() - started).toFixed(3)),
      ...requestMetrics(options),
      ...safeError(error),
    });
    throw error;
  }

  return {
    async *[Symbol.asyncIterator]() {
      let firstChunkMs;
      let finishKind;
      let usage;
      let thrown;
      try {
        for await (const chunk of source) {
          if (firstChunkMs === undefined && !['usage', 'finish'].includes(chunk.type)) {
            firstChunkMs = Number((performance.now() - started).toFixed(3));
          }
          if (chunk.type === 'usage') usage = chunk.usage;
          if (chunk.type === 'finish') finishKind = chunk.reason?.kind ?? 'unknown';
          yield chunk;
        }
      } catch (error) {
        thrown = error;
        throw error;
      } finally {
        ledger.record({
          kind: 'llm_call',
          status: thrown ? 'error' : finishKind ?? 'stream_closed',
          latency_ms: Number((performance.now() - started).toFixed(3)),
          first_chunk_ms: firstChunkMs,
          finish_kind: finishKind,
          ...requestMetrics(options),
          ...usageFields(usage),
          ...(thrown ? safeError(thrown) : {}),
        });
      }
    },
  };
}

async function observeToolExecution(exec, next, ledger) {
  const started = performance.now();
  let result;
  let thrown;
  try {
    result = await next();
    return result;
  } catch (error) {
    thrown = error;
    throw error;
  } finally {
    ledger.record({
      kind: 'tool_call',
      status: thrown || result?.isError ? 'error' : 'success',
      tool: exec.name,
      nested: exec.parent !== undefined,
      latency_ms: Number((performance.now() - started).toFixed(3)),
      argument_bytes: jsonBytes(exec.arguments),
      result_content_bytes: contentBytes(result?.content),
      result_error_code: result?.error?.info?.code,
      ...agentFields(exec.agent),
      ...(thrown ? safeError(thrown) : {}),
    });
  }
}

function selectedSessionEvent(session, event) {
  const base = {
    kind: 'session_metric',
    event_type: event.type,
    event_seq: event.seq,
    ...sessionFields(session),
  };
  if (event.type === 'step/start' || event.type === 'step/end') {
    return { ...base, turn: event.data.turn, step: event.data.step };
  }
  if (event.type === 'turn/end') {
    return { ...base, turn: event.data.turn, reason: event.data.reason?.kind ?? 'unknown' };
  }
  if (event.type.startsWith('compaction/')) {
    return {
      ...base,
      turn: event.data.turn,
      step: event.data.step,
      shadowed_token_count: event.data.shadowedTokenCount,
    };
  }
  if (event.type === 'llm/retry' || event.type === 'llm/retry-started') {
    return {
      ...base,
      turn: event.data.turn,
      step: event.data.step,
      provider: event.data.provider,
      retry: event.data.retry,
      max_retries: event.data.maxRetries,
      delay_ms: event.data.delayMs,
      failure_code: event.data.failure?.code,
    };
  }
  return undefined;
}

export function installEfficiencyObservers(ctx, ledger) {
  ctx.on('llm/stream', (options, next) => wrapLlmStream(options, next, ledger));
  ctx.on('tools/execute', (exec, next) => observeToolExecution(exec, next, ledger));
  ctx.on('session/event', (session, event) => {
    try {
      const selected = selectedSessionEvent(session, event);
      if (selected) ledger.record(selected);
    } catch (error) {
      ctx.logger.warn(`efficiency-ledger: session projection failed (${error instanceof Error ? error.name : 'Error'})`);
    }
  });
  ctx.on('agent/status', ({ agent, status }) => {
    ledger.record({ kind: 'agent_status', status, ...agentFields(agent) });
  });
  ctx.on('agent/error', ({ agent, turn, step, error }) => {
    ledger.record({
      kind: 'agent_error',
      status: 'error',
      turn,
      step,
      ...agentFields(agent),
      ...safeError(error),
    });
  });
}

function average(values) {
  return values.length === 0
    ? 0
    : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

export function summarizeLedgerRecords(records) {
  const llm = records.filter((record) => record.kind === 'llm_call');
  const tools = records.filter((record) => record.kind === 'tool_call');
  const tokenKeys = [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
  ];
  const tokens = Object.fromEntries(tokenKeys.map((key) => [
    key,
    llm.reduce((sum, record) => sum + (Number(record[key]) || 0), 0),
  ]));
  return Object.freeze({
    llmCalls: llm.length,
    llmErrors: llm.filter((record) => record.status === 'error').length,
    toolCalls: tools.length,
    toolErrors: tools.filter((record) => record.status === 'error').length,
    retries: records.filter((record) => record.event_type === 'llm/retry').length,
    compactions: records.filter((record) => record.event_type === 'compaction/end').length,
    averageLlmLatencyMs: average(llm.map((record) => record.latency_ms).filter(Number.isFinite)),
    averageFirstChunkMs: average(llm.map((record) => record.first_chunk_ms).filter(Number.isFinite)),
    averageToolLatencyMs: average(tools.map((record) => record.latency_ms).filter(Number.isFinite)),
    tokens: Object.freeze(tokens),
  });
}

export function apply(ctx, config = {}) {
  const ledger = new AppendOnlyEfficiencyLedger(config, ctx.logger);
  installEfficiencyObservers(ctx, ledger);
  ctx.effect(() => async () => ledger.close(), 'dsh-efficiency-ledger: flush local JSONL');
  ctx.logger.info(`efficiency-ledger: local metrics enabled at ${ledger.path}`);
}
