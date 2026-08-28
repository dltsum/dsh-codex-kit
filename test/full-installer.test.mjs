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
