import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LEDGER_SCHEMA } from '../src/efficiency-ledger.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runMetrics(dshHome) {
  return spawnSync(process.execPath, [join(root, 'bin', 'dsh-kit.mjs'), 'metrics', '--json'], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, DSH_HOME: dshHome },
  });
}

test('metrics CLI summarizes only the current ledger schema and reports mismatches', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-metrics-cli-'));
  try {
    const empty = runMetrics(temporary);
    assert.equal(empty.status, 0);
    assert.equal(JSON.parse(empty.stdout).status, 'warning');

    const metricsRoot = join(temporary, 'metrics', 'dsh-codex-kit');
    mkdirSync(metricsRoot, { recursive: true });
    const rows = [
      { schema: LEDGER_SCHEMA, kind: 'run_start', seq: 0, time: 1 },
      { schema: LEDGER_SCHEMA, kind: 'llm_call', seq: 1, time: 2, status: 'stop', inputTokens: 12, outputTokens: 3, latency_ms: 20 },
      { schema: LEDGER_SCHEMA, kind: 'tool_call', seq: 2, time: 3, status: 'success', tool: 'bash', latency_ms: 4 },
      { schema: 'foreign/schema', kind: 'llm_call', seq: 3, time: 4, inputTokens: 999999 },
    ];
    writeFileSync(
      join(metricsRoot, 'run-2026-08-28T00-00-00-000Z-1-fixture.jsonl'),
      `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
      'utf8',
    );

    const result = runMetrics(temporary);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.status, 'warning');
    assert.equal(parsed.metrics.llmCalls, 1);
    assert.equal(parsed.metrics.toolCalls, 1);
    assert.equal(parsed.metrics.tokens.inputTokens, 12);
    assert.deepEqual(parsed.parse_errors, [{ line: 4, error: 'SchemaMismatch' }]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
