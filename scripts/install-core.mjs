import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY_PROFILES } from '../src/capability-profiles.js';

const kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recommendedDsh = '0.1.1-rc.2';
const pinnedPnpm = '11.7.0';

function invocation(command, args) {
  if (process.platform !== 'win32' || !['npm', 'pnpm', 'dsh'].includes(command)) {
    return { file: command, args };
  }
  const shim = (process.env.PATH ?? '')
    .split(delimiter)
    .map((directory) => join(directory.replace(/^"|"$/gu, ''), `${command}.cmd`))
    .find(existsSync);
  if (!shim) return undefined;
  const scripts = {
    npm: join(dirname(shim), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    pnpm: join(dirname(shim), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    dsh: join(dirname(shim), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  };
  if (!existsSync(scripts[command])) return undefined;
  return { file: process.execPath, args: [scripts[command], ...args] };
}

function parseArgs(argv) {
  const result = {
    mode: 'lean',
    profiles: ['web', 'headless'],
    plugins: [],
    bundle: undefined,
    dshVersion: recommendedDsh,
    dryRun: false,
    skipDsh: false,
    acceptThirdPartyRisk: false,
    modeProvided: false,
    profilesProvided: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      if (arg.includes('=')) return arg.split(/=(.*)/su, 2)[1];
      if (index + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[++index];
    };
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--skip-dsh') result.skipDsh = true;
    else if (arg === '--accept-third-party-risk') result.acceptThirdPartyRisk = true;
    else if (arg === '--mode' || arg.startsWith('--mode=')) {
      result.mode = readValue();
      result.modeProvided = true;
    } else if (arg === '--profiles' || arg.startsWith('--profiles=')) {
      result.profiles = readValue().split(',').filter(Boolean);
      result.profilesProvided = true;
    } else if (arg === '--plugins' || arg.startsWith('--plugins=')) result.plugins = readValue().split(',').filter(Boolean);
    else if (arg === '--bundle' || arg.startsWith('--bundle=')) result.bundle = readValue();
    else if (arg === '--dsh-version' || arg.startsWith('--dsh-version=')) result.dshVersion = readValue();
    else throw new Error(`unknown option ${arg}`);
  }
  return result;
}

function displayCommand(command, args) {
  const quote = (value) => /\s/u.test(value) ? JSON.stringify(value) : value;
  return [command, ...args].map(quote).join(' ');
}

function run(command, args, { dryRun = false, capture = false, env = process.env } = {}) {
  console.log(`${dryRun ? '[dry-run]' : '[run]'} ${displayCommand(command, args)}`);
  if (dryRun) return { status: 0, stdout: '', stderr: '' };
  const resolved = invocation(command, args);
  if (!resolved) throw new Error(`${command} is not installed or its Windows shim cannot be resolved`);
  const result = spawnSync(resolved.file, resolved.args, {
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr || result.stdout}` : '';
    throw new Error(`${displayCommand(command, args)} failed with exit code ${result.status}${detail}`);
  }
  return result;
}

function commandVersion(command, args = ['--version']) {
  const resolved = invocation(command, args);
  if (!resolved) return undefined;
  const result = spawnSync(resolved.file, resolved.args, { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function assertNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major >= 24 || (major === 22 && minor >= 19))) {
    throw new Error(`Node ${process.versions.node} is unsupported; install Node 22.19+ or 24+`);
  }
}

function assertProfileNames(profiles) {
  const allowed = new Set(['web', 'headless']);
  if (profiles.length === 0) throw new Error('select at least one profile');
  for (const profile of profiles) if (!allowed.has(profile)) throw new Error(`unknown profile ${profile}`);
}

function validateCatalog(catalog, requested) {
  const byId = new Map(catalog.plugins.map((plugin) => [plugin.id, plugin]));
  return requested.map((id) => {
    const plugin = byId.get(id);
    if (!plugin) throw new Error(`unknown plugin id ${id}; run dsh-kit catalog`);
    if (!plugin.installSpec || !Array.isArray(plugin.profiles)) throw new Error(`catalog entry ${id} is not installable`);
    return plugin;
  });
}

function resolveBundle(catalog, requestedId) {
  if (!requestedId) return undefined;
  const bundle = (catalog.recommendedBundles ?? []).find((entry) => entry.id === requestedId);
  if (!bundle) throw new Error(`unknown recommended bundle ${requestedId}`);
  if (!['lean', 'balanced'].includes(bundle.mode)) throw new Error(`bundle ${requestedId} has an invalid mode`);
  assertProfileNames(bundle.profiles);
  if (!Array.isArray(bundle.plugins) || bundle.plugins.length === 0) {
    throw new Error(`bundle ${requestedId} has no plugin ids`);
  }
  return bundle;
}

function npmGlobalRoot(dryRun) {
  if (dryRun) {
    const resolved = invocation('npm', ['root', '-g']);
    if (!resolved) return '<npm-global-root>';
    const current = spawnSync(resolved.file, resolved.args, { encoding: 'utf8', windowsHide: true });
    if (current.status === 0) return current.stdout.trim();
    return '<npm-global-root>';
  }
  return run('npm', ['root', '-g'], { capture: true }).stdout.trim();
}

const options = parseArgs(process.argv.slice(2));
assertNode();
const catalog = JSON.parse(readFileSync(join(kitRoot, 'config', 'plugins.catalog.json'), 'utf8'));
const bundle = resolveBundle(catalog, options.bundle);
if (bundle) {
  if (!options.modeProvided) options.mode = bundle.mode;
  if (!options.profilesProvided) options.profiles = [...bundle.profiles];
  options.plugins = [...new Set([...bundle.plugins, ...options.plugins])];
}
assertProfileNames(options.profiles);
if (!['lean', 'balanced'].includes(options.mode)) throw new Error('--mode must be lean or balanced');
const selectedPlugins = validateCatalog(catalog, [...new Set(options.plugins)]);
if (selectedPlugins.length > 0 && !options.acceptThirdPartyRisk) {
  throw new Error('optional plugins execute third-party code; re-run with --accept-third-party-risk after reviewing config/plugins.catalog.json');
}

const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'));
const env = { ...process.env, DSH_HOME: dshHome };
console.log(`DSH_HOME=${dshHome}`);
console.log(`Mode=${options.mode}; profiles=${options.profiles.join(',')}; bundle=${bundle?.id ?? 'none'}`);
console.log(`Optional plugins=${selectedPlugins.map((plugin) => plugin.id).join(',') || 'none'}`);
if (selectedPlugins.length > 0) {
  const unpackedBytes = selectedPlugins.reduce((total, plugin) => total + (plugin.unpackedBytes ?? 0), 0);
  const runtimeDownloads = selectedPlugins.filter((plugin) => plugin.large).map((plugin) => plugin.id);
  console.log(`Catalog payload snapshot=${unpackedBytes} bytes; runtime-download entries=${runtimeDownloads.join(',') || 'none'}`);
}

if (!commandVersion('npm')) throw new Error('npm is required');
if (!commandVersion('pnpm')) run('npm', ['install', '-g', `pnpm@${pinnedPnpm}`], { dryRun: options.dryRun });

const currentDsh = commandVersion('dsh');
if (options.skipDsh) {
  if (!currentDsh) throw new Error('--skip-dsh was set but dsh is not installed');
  console.log(`Keeping installed DSH ${currentDsh}. Compatibility target is ${options.dshVersion}.`);
} else if (currentDsh !== options.dshVersion) {
  run('npm', ['install', '-g', `@deepseek-ai/dsh@${options.dshVersion}`], { dryRun: options.dryRun });
} else {
  console.log(`DSH ${currentDsh} already matches the pin.`);
}
const effectiveDshVersion = options.skipDsh ? currentDsh : options.dshVersion;
const requiredKitRows = [
  'dsh-codex-kit',
  'dsh-codex-kit-efficiency-ledger',
  'dsh-codex-kit-output-budget',
];

run('npm', ['install', '-g', kitRoot, '--ignore-scripts', '--no-audit', '--no-fund'], {
  dryRun: options.dryRun,
});

const npmRoot = npmGlobalRoot(options.dryRun);
const shippedPresetRoot = join(npmRoot, '@deepseek-ai', 'dsh', 'config', 'agent-presets');
const features = [];
if (selectedPlugins.some((plugin) => plugin.presetFeature === 'codex')) features.push('codex');
if (selectedPlugins.some((plugin) => plugin.presetFeature === 'claude')) features.push('claude');

if (options.profiles.includes('web')) {
  run('dsh', ['plugin', '--profile', 'web', 'add', kitRoot], { dryRun: options.dryRun, env });
  for (const capability of CAPABILITY_PROFILES) {
    const presetArgs = [
      join(kitRoot, 'scripts', 'create-preset.mjs'),
      '--source', join(shippedPresetRoot, capability.sourceDirectory),
      '--profile-id', capability.id,
      '--dsh-home', dshHome,
      '--mode', options.mode,
      '--dsh-version', effectiveDshVersion,
    ];
    if (capability.supportsSubagentFeatures) {
      for (const feature of features) presetArgs.push('--feature', feature);
    }
    run(process.execPath, presetArgs, { dryRun: options.dryRun, env });
  }
}

if (options.profiles.includes('headless')) {
  run(process.execPath, [
    join(kitRoot, 'scripts', 'create-headless-profile.mjs'),
    '--dsh-home', dshHome,
    '--mode', options.mode,
    '--dsh-version', effectiveDshVersion,
  ], { dryRun: options.dryRun, env });
  run('dsh', ['plugin', '--profile', 'skillopt-headless', 'add', kitRoot], { dryRun: options.dryRun, env });
}

for (const plugin of selectedPlugins) {
  const targets = plugin.profiles.filter((profile) => options.profiles.includes(profile));
  if (targets.length === 0) {
    console.warn(`[skip] ${plugin.id}: its supported profiles (${plugin.profiles.join(',')}) were not selected`);
    continue;
  }
  for (const profile of targets) {
    run('dsh', ['plugin', '--profile', profile, 'add', plugin.installSpec], { dryRun: options.dryRun, env });
  }
}

if (!options.dryRun) {
  for (const profile of options.profiles) {
    const actual = profile === 'headless' ? 'skillopt-headless' : profile;
    const dump = run('dsh', ['--profile', actual, '--dump-config'], { capture: true, env });
    const combined = `${dump.stdout}\n${dump.stderr}`;
    const missing = requiredKitRows.filter((id) => !combined.includes(id));
    if (missing.length > 0) {
      throw new Error(`validation failed: ${missing.join(', ')} absent from composed ${actual} config`);
    }
    console.log(`[verified] ${actual} composes ${requiredKitRows.join(', ')}`);
  }
}

console.log('\nInstallation complete. No browser or model process was started.');
if (options.profiles.includes('web')) {
  console.log('Web: start with `dsh web --no-open`, then select SkillOpt Standard, Code, or Minimal for a new session.');
}
if (options.profiles.includes('headless')) {
  console.log('Headless: `dsh --profile skillopt-headless "your task"` or `dsh-kit run "your task"`.');
}
console.log('Diagnostics: `dsh-kit doctor --deep`. Metrics: `dsh-kit metrics`. Optional Code Mode: `dsh-kit run --code "your task"`.');
console.log(JSON.stringify({
  status: 'success',
  summary: bundle
    ? `Installed DSH Codex Kit with the ${bundle.id} bundle.`
    : 'Installed DSH Codex Kit.',
  next_actions: [
    ...(options.profiles.includes('web') ? ['Start Web manually with: dsh web --no-open'] : []),
    ...(options.profiles.includes('headless') ? ['Run diagnostics: dsh-kit doctor --deep'] : []),
    'Configure provider credentials separately for features that need them.',
  ],
  artifacts: [
    ...(options.profiles.includes('web')
      ? CAPABILITY_PROFILES.map((profile) => join(dshHome, '.agent-presets', profile.targetDirectory))
      : []),
    ...(options.profiles.includes('headless') ? [join(dshHome, 'profiles', 'skillopt-headless')] : []),
    join(dshHome, 'metrics', 'dsh-codex-kit'),
  ],
}, null, 2));
