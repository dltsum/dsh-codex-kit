#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY_PROFILES } from '../src/capability-profiles.js';
import {
  defaultLedgerRoot,
  LEDGER_SCHEMA,
  summarizeLedgerRecords,
} from '../src/efficiency-ledger.js';

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
  const presets = Object.fromEntries(CAPABILITY_PROFILES.map((capability) => {
    const marker = join(dshHome, '.agent-presets', capability.targetDirectory, '.dsh-codex-kit.json');
    return [capability.id, { ok: existsSync(marker), marker }];
  }));
  const profile = join(dshHome, 'profiles', 'skillopt-headless', '.dsh-codex-kit.json');
  const metricsRoot = defaultLedgerRoot({ ...process.env, DSH_HOME: dshHome });
  const installedPresetCount = Object.values(presets).filter((value) => value.ok).length;
  const checks = {
    kitVersion: packageJson.version,
    recommendedDsh: '0.1.1-rc.2',
    dshHome,
    node,
    npm,
    pnpm,
    dsh,
    capabilityPresets: presets,
    skilloptHeadless: { ok: existsSync(profile), marker: profile },
    efficiencyLedger: {
      root: metricsRoot,
      files: existsSync(metricsRoot)
        ? readdirSync(metricsRoot).filter((file) => file.endsWith('.jsonl')).length
        : 0,
    },
  };

  if (deep && dsh.ok) {
    const profilesToValidate = [
      ...(installedPresetCount > 0 ? ['web'] : []),
      ...(checks.skilloptHeadless.ok ? ['skillopt-headless'] : []),
    ];
    checks.composedConfigs = Object.fromEntries(profilesToValidate.map((profileName) => {
      const dump = command('dsh', ['--profile', profileName, '--dump-config'], {
        env: { ...process.env, DSH_HOME: dshHome },
        maxBuffer: 16 * 1024 * 1024,
      });
      const text = `${dump.stdout ?? ''}\n${dump.stderr ?? ''}`;
      const value = {
        ok: dump.status === 0
          && text.includes('dsh-codex-kit')
          && text.includes('dsh-codex-kit-efficiency-ledger')
          && text.includes('dsh-codex-kit-output-budget')
          && (profileName !== 'skillopt-headless' || text.includes('tool-skill')),
        exitCode: dump.status,
        hasKit: text.includes('dsh-codex-kit'),
        hasEfficiencyLedger: text.includes('dsh-codex-kit-efficiency-ledger'),
        hasOutputBudget: text.includes('dsh-codex-kit-output-budget'),
        hasToolSkillRow: text.includes('tool-skill'),
      };
      return [profileName, value];
    }));
  }

  const required = [node, npm, pnpm, dsh];
  const capabilityPresetStateOk = installedPresetCount === 0
    || installedPresetCount === CAPABILITY_PROFILES.length;
  const deepTargets = Object.values(checks.composedConfigs ?? {});
  const ok = required.every((item) => item.ok)
    && capabilityPresetStateOk
    && (!deep || (deepTargets.length > 0 && deepTargets.every((value) => value.ok)));
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ok, checks }, null, 2)}\n`);
  } else {
    console.log(`DSH Codex Kit ${packageJson.version}`);
    console.log(`Node: ${node.value} ${node.ok ? 'OK' : 'UNSUPPORTED (need 22.19+ or 24+)'}`);
    console.log(`npm: ${npm.ok ? npm.value : 'missing'}`);
    console.log(`pnpm: ${pnpm.ok ? pnpm.value : 'missing'}`);
    console.log(`dsh: ${dsh.ok ? dsh.value : 'missing'} (recommended 0.1.1-rc.2)`);
    console.log(`Web capability presets: ${Object.entries(presets)
      .map(([name, value]) => `${name}=${value.ok ? 'installed' : 'missing'}`)
      .join(', ')}`);
    console.log(`Headless lean profile: ${checks.skilloptHeadless.ok ? 'installed' : 'not installed'}`);
    console.log(`Local metric ledgers: ${checks.efficiencyLedger.files} in ${checks.efficiencyLedger.root}`);
    for (const [profileName, value] of Object.entries(checks.composedConfigs ?? {})) {
      console.log(`Composed ${profileName} validation: ${value.ok ? 'OK' : 'FAILED'}`);
    }
  }
  process.exitCode = ok ? 0 : 1;
}

function readLedger(path) {
  const records = [];
  const errors = [];
  for (const [index, line] of readFileSync(path, 'utf8').split(/\r?\n/gu).entries()) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (!record || typeof record !== 'object' || record.schema !== LEDGER_SCHEMA) {
        errors.push({ line: index + 1, error: 'SchemaMismatch' });
      } else {
        records.push(record);
      }
    } catch (error) {
      errors.push({ line: index + 1, error: error instanceof Error ? error.name : 'Error' });
    }
  }
  return { records, errors };
}

function metrics(asJson) {
  const root = defaultLedgerRoot();
  const files = existsSync(root)
    ? readdirSync(root).filter((file) => file.endsWith('.jsonl')).sort().reverse()
    : [];
  if (files.length === 0) {
    const result = {
      status: 'warning',
      summary: 'No local efficiency ledger exists yet; run a DSH task after installing v0.3.0.',
      next_actions: ['Run a task, then repeat: dsh-kit metrics'],
      artifacts: [root],
      metrics: summarizeLedgerRecords([]),
    };
    if (asJson) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      console.log(`status: ${result.status}`);
      console.log(`summary: ${result.summary}`);
      console.log(`next_actions: ${result.next_actions.join(' ')}`);
      console.log(`artifacts: ${result.artifacts.join(', ')}`);
    }
    return;
  }

  const path = join(root, files[0]);
  const { records, errors } = readLedger(path);
  const summary = summarizeLedgerRecords(records);
  const result = {
    status: errors.length === 0 ? 'success' : 'warning',
    summary: `Summarized ${summary.llmCalls} model calls and ${summary.toolCalls} tool calls from the latest local ledger.`,
    next_actions: errors.length > 0
      ? ['Inspect the reported malformed JSONL line numbers before relying on totals.']
      : ['Compare this ledger with a matched baseline task before claiming an optimization.'],
    artifacts: [path],
    metrics: summary,
    parse_errors: errors,
  };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log(`status: ${result.status}`);
  console.log(`summary: ${result.summary}`);
  console.log(`next_actions: ${result.next_actions.join(' ')}`);
  console.log(`artifacts: ${result.artifacts.join(', ')}`);
  console.log(`LLM errors=${summary.llmErrors}; tool errors=${summary.toolErrors}; retries=${summary.retries}; compactions=${summary.compactions}`);
  console.log(`Tokens: input=${summary.tokens.inputTokens}, output=${summary.tokens.outputTokens}, cache-read=${summary.tokens.cacheReadTokens}, cache-write=${summary.tokens.cacheWriteTokens}`);
  console.log(`Average latency: model=${summary.averageLlmLatencyMs}ms, first-chunk=${summary.averageFirstChunkMs}ms, tool=${summary.averageToolLatencyMs}ms`);
  if (errors.length > 0) console.log(`Warning: ${errors.length} malformed ledger lines were excluded.`);
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
  dsh-kit metrics [--json]
  dsh-kit run [--code] <task...>

The run command uses the generated skillopt-headless profile. --code is opt-in
because not every model/provider handles DSH Code Mode equally well.`);
}

const [subcommand = 'help', ...args] = process.argv.slice(2);
if (subcommand === 'doctor') doctor(args.includes('--json'), args.includes('--deep'));
else if (subcommand === 'catalog') catalog(args.includes('--json'));
else if (subcommand === 'metrics') metrics(args.includes('--json'));
else if (subcommand === 'run') runHeadless(args);
else if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') usage();
else {
  usage();
  process.exitCode = 2;
}
