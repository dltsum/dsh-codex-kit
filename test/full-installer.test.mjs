import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('full installer entry points select the reviewed bundle and explicit risk opt-in', () => {
  const powershell = readFileSync(join(root, 'install-full.ps1'), 'utf8');
  const shell = readFileSync(join(root, 'install-full.sh'), 'utf8');

  assert.match(powershell, /Bundle = 'recommended-full'/u);
  assert.match(powershell, /AcceptThirdPartyRisk = \$true/u);
  assert.match(shell, /--bundle recommended-full/u);
  assert.match(shell, /--accept-third-party-risk/u);
});

test('core bundle and installer require all three local optimization plugins', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
  const installer = readFileSync(join(root, 'scripts', 'install-core.mjs'), 'utf8');
  for (const id of [
    'dsh-codex-kit',
    'dsh-codex-kit-efficiency-ledger',
    'dsh-codex-kit-output-budget',
  ]) {
    assert.match(patch, new RegExp(`id: ${id}`, 'u'));
    assert.match(installer, new RegExp(`'${id}'`, 'u'));
  }
});
