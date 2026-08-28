import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  AppendOnlyEfficiencyLedger,
  installEfficiencyObservers,
  summarizeLedgerRecords,
} from '../src/efficiency-ledger.js';

function fakeContext() {
  const listeners = new Map();
  const warnings = [];
  return {
    listeners,
    warnings,
    logger: {
      info() {},
      warn(message) { warnings.push(message); },
    },
    on(name, listener) {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    },
  };
}

async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

test('ledger records metrics while excluding prompt, result, argument and path content', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-efficiency-ledger-'));
  try {
    const ctx = fakeContext();
    const ledger = new AppendOnlyEfficiencyLedger({ root: temporary, maxPendingRecords: 64 }, ctx.logger);
    installEfficiencyObservers(ctx, ledger);

    const llmStream = ctx.listeners.get('llm/stream');
    const chunks = await collect(llmStream({
      provider: 'fixture-provider',
      model: 'fixture-model',
      sessionId: 'session-secret-id',
      system: 'SUPER_SECRET_SYSTEM_PROMPT',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'SUPER_SECRET_USER_MESSAGE' }] }],
      tools: [{ name: 'fixture', description: 'SUPER_SECRET_TOOL_SCHEMA', parameters: {} }],
      maxTokens: 128,
    }, () => (async function* stream() {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'SUPER_SECRET_MODEL_OUTPUT' };
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 7 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }())));
    assert.equal(chunks.length, 4);

    const toolExecute = ctx.listeners.get('tools/execute');
    const session = { header: { id: 'session-secret-id', cwd: 'C:/private/workspace/name' } };
    await toolExecute({
      name: 'bash',
      arguments: { command: 'SUPER_SECRET_TOOL_ARGUMENT' },
      agent: { session },
    }, async () => ({
      isError: false,
      content: [{ type: 'text', text: 'SUPER_SECRET_TOOL_RESULT' }],
    }));

    const sessionEvent = ctx.listeners.get('session/event');
    sessionEvent(session, { type: 'step/start', seq: 1, data: { turn: 1, step: 1 } });
    sessionEvent(session, {
      type: 'user/message',
      seq: 2,
      data: { content: [{ type: 'text', text: 'SUPER_SECRET_DURABLE_MESSAGE' }] },
    });
    sessionEvent(session, {
      type: 'llm/retry',
      seq: 3,
      data: { turn: 1, step: 1, provider: 'fixture-provider', retry: 1, delayMs: 100, failure: { code: 'RATE_LIMIT', message: 'SUPER_SECRET_PROVIDER_REPLY' } },
    });

    ctx.listeners.get('agent/error')({
      agent: { session },
      turn: 1,
      step: 1,
      error: new Error('SUPER_SECRET_ERROR_MESSAGE'),
    });
    await ledger.close();

    const raw = readFileSync(ledger.path, 'utf8');
    for (const secret of [
      'SUPER_SECRET_SYSTEM_PROMPT',
      'SUPER_SECRET_USER_MESSAGE',
      'SUPER_SECRET_TOOL_SCHEMA',
      'SUPER_SECRET_MODEL_OUTPUT',
      'SUPER_SECRET_TOOL_ARGUMENT',
      'SUPER_SECRET_TOOL_RESULT',
      'SUPER_SECRET_DURABLE_MESSAGE',
      'SUPER_SECRET_PROVIDER_REPLY',
      'SUPER_SECRET_ERROR_MESSAGE',
      'C:/private/workspace/name',
      'session-secret-id',
    ]) assert.equal(raw.includes(secret), false, `ledger leaked ${secret}`);

    const records = raw.trim().split(/\r?\n/gu).map((line) => JSON.parse(line));
    const summary = summarizeLedgerRecords(records);
    assert.equal(summary.llmCalls, 1);
    assert.equal(summary.toolCalls, 1);
    assert.equal(summary.retries, 1);
    assert.equal(summary.tokens.inputTokens, 10);
    assert.equal(summary.tokens.outputTokens, 4);
    assert.equal(summary.tokens.cacheReadTokens, 7);
    assert.equal(records.some((record) => record.workspace_hash && record.workspace_hash.length === 16), true);
    assert.equal(records.at(-1).kind, 'run_end');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
