import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOutputBudgetPolicy,
  resolveOutputBudgetConfig,
} from '../src/output-budget.js';

function fixture({ failSave = false } = {}) {
  const saved = [];
  const warnings = [];
  const ctx = {
    logger: { warn: (message) => warnings.push(message) },
    get(name) {
      if (name !== 'spillStore') return undefined;
      return {
        async saveText(input) {
          if (failSave) throw new Error('fixture storage failure');
          saved.push(input);
          return {
            locator: 'C:/spill/result.txt',
            bytes: Buffer.byteLength(input.content, 'utf8'),
            retrievalHint: 'Use read with offset/limit on this path.',
          };
        },
      };
    },
  };
  return { ctx, saved, warnings };
}

function execution(name = 'bash') {
  return {
    name,
    callId: 'call-1',
    arguments: {},
    agent: { session: { header: { id: 'session-1' } } },
  };
}

test('output budget validates all caps and tool names explicitly', () => {
  assert.equal(resolveOutputBudgetConfig({}).defaultMaxInlineBytes, 16 * 1024);
  assert.throws(() => resolveOutputBudgetConfig({ defaultMaxInlineBytes: 10 }), /defaultMaxInlineBytes/u);
  assert.throws(() => resolveOutputBudgetConfig({ toolMaxInlineBytes: { 'bad tool': 1024 } }), /tool name/u);
  assert.throws(() => resolveOutputBudgetConfig({ unknown: true }), /unknown config key/u);
});

test('oversized plain text is saved losslessly and replaced within the selected budget', async () => {
  const { ctx, saved } = fixture();
  const policy = createOutputBudgetPolicy(ctx, {
    defaultMaxInlineBytes: 1024,
    toolMaxInlineBytes: { bash: 768 },
  });
  const original = 'begin\n' + 'x'.repeat(5000) + '\nend';
  const result = { isError: false, content: [{ type: 'text', text: original }] };
  const decision = await policy.postExecute(execution(), result, async () => ({ kind: 'accept' }));

  assert.equal(saved.length, 1);
  assert.equal(saved[0].content, original);
  assert.equal(saved[0].source.label, 'budget-result');
  assert.equal(decision.kind, 'accept');
  assert.ok(Buffer.byteLength(decision.content[0].text, 'utf8') <= 768);
  assert.match(decision.content[0].text, /status: warning/u);
  assert.match(decision.content[0].text, /next_actions:/u);
  assert.match(decision.content[0].text, /artifacts: C:\/spill\/result\.txt/u);
  assert.equal(result.content[0].text, original);
});

test('read results and storage failures preserve the original model-facing content', async () => {
  const text = 'z'.repeat(5000);
  const result = { isError: false, content: [{ type: 'text', text }] };

  const skipped = fixture();
  const skipPolicy = createOutputBudgetPolicy(skipped.ctx, { defaultMaxInlineBytes: 512 });
  const skipDecision = await skipPolicy.postExecute(execution('read'), result, async () => ({ kind: 'accept' }));
  assert.deepEqual(skipDecision, { kind: 'accept' });
  assert.equal(skipped.saved.length, 0);

  const failed = fixture({ failSave: true });
  const failPolicy = createOutputBudgetPolicy(failed.ctx, {
    defaultMaxInlineBytes: 512,
    toolMaxInlineBytes: { bash: 512 },
  });
  const failDecision = await failPolicy.postExecute(execution(), result, async () => ({ kind: 'accept' }));
  assert.deepEqual(failDecision, { kind: 'accept' });
  assert.equal(failed.warnings.some((message) => message.includes('saveText failed')), true);
});

test('Code Mode dispatch logs are bounded without changing the program value', async () => {
  const { ctx, saved } = fixture();
  const policy = createOutputBudgetPolicy(ctx, {
    defaultMaxInlineBytes: 640,
    toolMaxInlineBytes: { grep: 640 },
  });
  const content = [{ type: 'text', text: 'q'.repeat(4096) }];
  const dispatch = {
    exec: execution('run_code'),
    name: 'grep',
    subCallId: 'call-1:code:1',
  };
  const replacement = await policy.codeDispatchLog(dispatch, async () => content);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].content, content[0].text);
  assert.equal(saved[0].source.label, 'budget-dispatch');
  assert.ok(Buffer.byteLength(replacement[0].text, 'utf8') <= 640);
});
