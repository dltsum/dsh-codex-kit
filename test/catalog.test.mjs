import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'config', 'plugins.catalog.json'), 'utf8'));

test('plugin catalog has unique ids and exact non-latest install specs', () => {
  const ids = catalog.plugins.map((plugin) => plugin.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const plugin of catalog.plugins) {
    assert.match(plugin.installSpec, /@\d|#(?:v?\d|[0-9a-f]{40})/u);
    assert.doesNotMatch(plugin.installSpec, /@latest|#main|#master/u);
    assert.ok(Array.isArray(plugin.permissions) && plugin.permissions.length > 0);
    assert.ok(['npm-verified', 'npm-and-tag-verified', 'npm-and-head-verified', 'official-next-tag-verified'].includes(plugin.status));
  }
});

test('large or sensitive capabilities are never default-installed', () => {
  assert.deepEqual(catalog.policy.defaultInstall, []);
  assert.equal(catalog.plugins.some((plugin) => plugin.large && catalog.policy.defaultInstall.includes(plugin.id)), false);
});
