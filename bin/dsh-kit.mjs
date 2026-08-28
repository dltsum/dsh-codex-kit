#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8'));

function invocation(commandName, args) {
  if (process.platform !== 'win32' || !['npm', 'pnpm', 'dsh'].includes(commandName)) {
    return { file: commandName, args };
  }
  const shim = (process.env.PATH ?? '')
    .split(delimiter)
    .map((directory) => join(directory.replace(/^"|"$/gu, ''), `${commandName}.cmd`))
    .find(existsSync);
  if (!shim) return undefined;
  const scripts = {
    npm: join(dirname(shim), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    pnpm: join(dirname(shim), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    dsh: join(dirname(shim), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  };
  return existsSync(scripts[commandName])
    ? { file: process.execPath, args: [scripts[commandName], ...args] }
    : undefined;
}

function command(commandName, args, options = {}) {
  const resolved = invocation(commandName, args);
  if (!resolved) return { status: null, stdout: '', stderr: '', error: new Error(`${commandName} is not installed`) };
  return spawnSync(resolved.file, resolved.args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
}

function parseVersion(value) {
  const match = String(value).match(/(\d+)\.(\d+)\.(\d+)/u);
  return match ? match.slice(1).map(Number) : undefined;
}

function supportedNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major >= 24 || (major === 22 && minor >= 19);
}

function getDshHome() {
  return resolve(process.env.DSH_HOME || join(homedir(), '.dsh'));
}

function checkCommand(name, args = ['--version']) {
  const result = command(name, args);
  return {
    ok: result.status === 0,
    value: result.status === 0 ? result.stdout.trim() : undefined,
    error: result.status === 0 ? undefined : (result.stderr || result.error?.message || 'not found').trim(),
  };
}

function doctor(asJson, deep) {
  const dshHome = getDshHome();
  const node = { ok: supportedNode(), value: process.versions.node };
  const npm = checkCommand('npm');
  const pnpm = checkCommand('pnpm');
  const dsh = checkCommand('dsh');
  const preset = join(dshHome, '.agent-presets', 'skillopt-standard', '.dsh-codex-kit.json');
  const profile = join(dshHome, 'profiles', 'skillopt-headless', '.dsh-codex-kit.json');
  const checks = {
    kitVersion: packageJson.version,
    recommendedDsh: '0.1.1-rc.2',
    dshHome,
    node,
    npm,
    pnpm,
    dsh,
    skilloptPreset: { ok: existsSync(preset), marker: preset },
    skilloptHeadless: { ok: existsSync(profile), marker: profile },
  };

  if (deep && dsh.ok && checks.skilloptHeadless.ok) {
    const dump = command('dsh', ['--profile', 'skillopt-headless', '--dump-config'], {
      env: { ...process.env, DSH_HOME: dshHome },
      maxBuffer: 16 * 1024 * 1024,
    });
    const text = `${dump.stdout ?? ''}\n${dump.stderr ?? ''}`;
    checks.composedConfig = {
      ok: dump.status === 0 && text.includes('dsh-codex-kit') && text.includes('tool-skill'),
      exitCode: dump.status,
      hasKit: text.includes('dsh-codex-kit'),
      hasToolSkillRow: text.includes('tool-skill'),
    };
  }

  const required = [node, npm, pnpm, dsh];
  const ok = required.every((item) => item.ok)
    && (!deep || !checks.skilloptHeadless.ok || checks.composedConfig?.ok);
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ok, checks }, null, 2)}\n`);
  } else {
    console.log(`DSH Codex Kit ${packageJson.version}`);
    console.log(`Node: ${node.value} ${node.ok ? 'OK' : 'UNSUPPORTED (need 22.19+ or 24+)'}`);
    console.log(`npm: ${npm.ok ? npm.value : 'missing'}`);
    console.log(`pnpm: ${pnpm.ok ? pnpm.value : 'missing'}`);
    console.log(`dsh: ${dsh.ok ? dsh.value : 'missing'} (recommended 0.1.1-rc.2)`);
    console.log(`Web lean preset: ${checks.skilloptPreset.ok ? 'installed' : 'not installed'}`);
    console.log(`Headless lean profile: ${checks.skilloptHeadless.ok ? 'installed' : 'not installed'}`);
    if (checks.composedConfig) console.log(`Composed profile validation: ${checks.composedConfig.ok ? 'OK' : 'FAILED'}`);
  }
  process.exitCode = ok ? 0 : 1;
}

function catalog(asJson) {
  const data = JSON.parse(readFileSync(join(kitRoot, 'config', 'plugins.catalog.json'), 'utf8'));
  if (asJson) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  for (const plugin of data.plugins) {
    console.log(`${plugin.id.padEnd(18)} ${plugin.version.padEnd(13)} ${plugin.large ? 'large/risky' : 'optional'}  ${plugin.name}`);
  }
  for (const bundle of data.recommendedBundles ?? []) {
    console.log(`\nbundle ${bundle.id}: ${bundle.plugins.join(', ')}`);
  }
  console.log('\nThe standard installer selects nothing. Use install-full.ps1/install-full.sh for the explicit full bundle, or select plugin ids manually.');
}

function runHeadless(args) {
  const codeIndex = args.indexOf('--code');
  const useCodeMode = codeIndex !== -1;
  if (useCodeMode) args.splice(codeIndex, 1);
  const result = command('dsh', ['--profile', 'skillopt-headless', ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...(useCodeMode ? { DSH_TOOLS_MODE: 'code' } : {}) },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function usage() {
  console.log(`Usage:
  dsh-kit doctor [--json] [--deep]
  dsh-kit catalog [--json]
  dsh-kit run [--code] <task...>

The run command uses the generated skillopt-headless profile. --code is opt-in
because not every model/provider handles DSH Code Mode equally well.`);
}

const [subcommand = 'help', ...args] = process.argv.slice(2);
if (subcommand === 'doctor') doctor(args.includes('--json'), args.includes('--deep'));
else if (subcommand === 'catalog') catalog(args.includes('--json'));
else if (subcommand === 'run') runHeadless(args);
else if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') usage();
else {
  usage();
  process.exitCode = 2;
}
