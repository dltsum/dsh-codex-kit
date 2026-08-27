import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSkillIndex,
  estimateCatalogTokens,
  estimateTokens,
  normalizeText,
  searchSkillIndex,
  tokenize,
} from '../src/retrieval.js';
import { CatalogIndexCache, digestCatalog } from '../src/catalog-cache.js';

function skill(name, description, whenToUse = '') {
  return {
    name,
    description,
    whenToUse,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'fixture',
    source: 'custom',
  };
}

test('normalization and tokenization are deterministic across separators and Han text', () => {
  assert.equal(normalizeText('  Code_Review/安全  '), 'code review 安全');
  assert.deepEqual(tokenize('代码审查'), ['代', '码', '审', '查', '代码', '码审', '审查']);
  assert.deepEqual(tokenize('Code-review 2026'), ['code', 'review', '2026']);
});

test('exact name and weighted name terms outrank description-only matches', () => {
  const index = buildSkillIndex([
    skill('code-review', 'Review changes for correctness'),
    skill('security-audit', 'Includes a code review checklist'),
    skill('writing', 'Edit prose'),
  ]);
  const result = searchSkillIndex(index, 'code-review', { tokenBudget: 300, limit: 3 });
  assert.equal(result.selected[0].name, 'code-review');
  assert.ok(result.selected[0].score > result.selected[1].score);
});

test('irrelevant zero-score skills are omitted instead of guessed', () => {
  const index = buildSkillIndex([skill('writing', 'Edit prose')]);
  const result = searchSkillIndex(index, 'quantum chemistry', { tokenBudget: 300 });
  assert.deepEqual(result.selected, []);
  assert.equal(result.totalMatches, 0);
});

test('metadata output honors the configured token budget', () => {
  const index = buildSkillIndex(Array.from({ length: 20 }, (_, indexValue) => skill(
    `testing-${indexValue}`,
    `Testing workflow ${indexValue} ${'detailed '.repeat(80)}`,
  )));
  const result = searchSkillIndex(index, 'testing', { tokenBudget: 96, limit: 20, descriptionMaxChars: 800 });
  assert.ok(result.selected.length >= 1);
  assert.ok(result.usedTokens <= 96);
  assert.ok(result.selected.every((entry) => entry.estimatedTokens <= 96));
});

test('token estimates count Han more conservatively than Latin characters', () => {
  assert.equal(estimateTokens('测试测试'), 4);
  assert.equal(estimateTokens('abcdefgh'), 2);
  assert.ok(estimateCatalogTokens([skill('测试', '处理中文任务')]) > 0);
});

test('catalog digest ignores input order and cache evicts least recently used entry', () => {
  const first = [skill('alpha', 'one'), skill('beta', 'two')];
  const reordered = [first[1], first[0]];
  assert.equal(digestCatalog(first), digestCatalog(reordered));

  const cache = new CatalogIndexCache(2);
  assert.equal(cache.getOrBuild(first).cacheHit, false);
  assert.equal(cache.getOrBuild(reordered).cacheHit, true);
  cache.getOrBuild([skill('gamma', 'three')]);
  cache.getOrBuild([skill('delta', 'four')]);
  assert.equal(cache.size, 2);
  assert.equal(cache.getOrBuild(first).cacheHit, false);
});

test('incomplete snapshots can build an index without polluting the cache', () => {
  const cache = new CatalogIndexCache(2);
  const result = cache.getOrBuild([skill('alpha', 'one')], { cacheable: false });
  assert.equal(result.cacheHit, false);
  assert.equal(cache.size, 0);
});
