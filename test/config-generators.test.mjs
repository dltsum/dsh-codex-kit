import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runScript(name, args) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', name), ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`${name} failed:\n${result.stderr}\n${result.stdout}`);
  return result;
}

function standardFixture() {
  return `- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'

- id: compaction
  name: cordis:group
  group: true
  config:
    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024

- id: delegation
  name: cordis:group
  group: true
  config:
    - id: tool-subagent-codex
      name: '@deepseek-ai/dsh-tool-subagent'
      disabled: true
      config:
        provider: codex

    - id: tool-subagent-claude-code
      name: '@deepseek-ai/dsh-tool-subagent'
      disabled: true
      config:
        provider: claude-code
`;
}

test('preset generator applies only exact anchors and backs up owned updates', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-codex-kit-preset-'));
  try {
    const source = join(temporary, 'standard');
    const home = join(temporary, 'home');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'agent.cordis.yml'), standardFixture(), 'utf8');
    writeFileSync(join(source, 'preset.yml'), 'name: Standard\ndescription: Complete\norder: 1\n', 'utf8');

    const args = ['--source', source, '--dsh-home', home, '--mode', 'lean', '--dsh-version', '0.1.1-rc.2', '--feature', 'codex'];
    runScript('create-preset.mjs', args);
    const target = join(home, '.agent-presets', 'skillopt-standard');
    const text = readFileSync(join(target, 'agent.cordis.yml'), 'utf8');
    assert.match(text, /maxBytes: 32768/u);
    assert.match(text, /thresholdChars: 6144/u);
    assert.match(text, /id: tool-skill\n  name: '@deepseek-ai\/dsh-tool-skill'\n  disabled: true/u);
    assert.doesNotMatch(text, /id: tool-subagent-codex\n      name: '@deepseek-ai\/dsh-tool-subagent'\n      disabled: true/u);
    assert.match(text, /id: tool-subagent-claude-code[\s\S]*?disabled: true/u);

    runScript('create-preset.mjs', args);
    const backups = readdirSync(join(home, 'backups', 'dsh-codex-kit'));
    assert.equal(backups.length, 1);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('headless profile generator creates an ownership-marked lean overlay', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-codex-kit-headless-'));
  try {
    runScript('create-headless-profile.mjs', ['--dsh-home', temporary, '--mode', 'lean', '--dsh-version', '0.1.1-rc.2']);
    const target = join(temporary, 'profiles', 'skillopt-headless');
    assert.equal(existsSync(join(target, '.dsh-codex-kit.json')), true);
    const patch = readFileSync(join(target, 'cordis.patch.yml'), 'utf8');
    assert.match(patch, /id: tool-skill\n  disabled: true/u);
    assert.match(patch, /maxBytes: 32768/u);
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
