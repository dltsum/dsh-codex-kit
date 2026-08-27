import assert from 'node:assert/strict';
import test from 'node:test';
import { createSkillOptTool, resolveConfig } from '../src/index.js';

const skills = [
  {
    name: 'code-review',
    description: 'Review code for correctness and security.',
    whenToUse: 'Before merging a change.',
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'fixture',
    source: 'custom',
  },
  {
    name: 'human-only',
    description: 'Must not be exposed to the model.',
    invocation: { modelInvocable: false, userInvocable: true },
    provider: 'fixture',
    source: 'custom',
  },
];

function fixture() {
  const calls = [];
  const ctx = {
    skills: {
      async snapshot(options) {
        calls.push(['snapshot', options]);
        return { skills, complete: true };
      },
      async get(name, options) {
        calls.push(['get', name, options]);
        const found = skills.find((entry) => entry.name === name);
        return found ? { ...found, content: '# Full instructions\nDo the review.' } : undefined;
      },
    },
  };
  return { ctx, calls };
}

function execution() {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    agent: { session: { header: { cwd: '/workspace' } } },
  };
}

test('config rejects silent out-of-range fallbacks', () => {
  assert.equal(resolveConfig({}).maxResults, 5);
  assert.throws(() => resolveConfig({ maxResults: 0 }), /maxResults/u);
  assert.throws(() => resolveConfig({ cacheMaxEntries: 999 }), /cacheMaxEntries/u);
});

test('search returns only model-invocable skills and exposes heuristic savings as metrics', async () => {
  const { ctx } = fixture();
  const tool = createSkillOptTool(ctx, { defaultTokenBudget: 128 });
  const value = await tool.execute({ action: 'search', query: 'review code' }, execution());
  assert.equal(value.action, 'search');
  assert.deepEqual(value.selected.map((entry) => entry.name), ['code-review']);
  assert.equal(value.metrics.catalogSize, 1);
  assert.ok(value.metrics.estimatedCatalogTokensAvoided >= 0);
});

test('load uses the exact current winning skill and canonical skill renderer', async () => {
  const { ctx, calls } = fixture();
  const tool = createSkillOptTool(ctx);
  const value = await tool.execute({ action: 'load', name: 'code-review' }, execution());
  assert.equal(value.loaded.name, 'code-review');
  assert.match(value.loaded.rendered, /<skill_content name="code-review">/u);
  assert.match(value.loaded.rendered, /# Full instructions/u);
  assert.equal(calls.some((entry) => entry[0] === 'get'), true);
});

test('load fails explicitly for hidden or unknown skills', async () => {
  const { ctx } = fixture();
  const tool = createSkillOptTool(ctx);
  await assert.rejects(() => tool.execute({ action: 'load', name: 'human-only' }, execution()), /unavailable/u);
  await assert.rejects(() => tool.execute({ action: 'load', name: 'missing' }, execution()), /unknown|unavailable/u);
});

test('search rejects missing query and stats reports catalog completeness', async () => {
  const { ctx } = fixture();
  const tool = createSkillOptTool(ctx);
  await assert.rejects(() => tool.execute({ action: 'search' }, execution()), /query is required/u);
  const value = await tool.execute({ action: 'stats' }, execution());
  assert.equal(value.metrics.catalogComplete, true);
  assert.equal(value.metrics.catalogSize, 1);
});
