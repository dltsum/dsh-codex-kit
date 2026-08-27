import { createHash, randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

function parseArgs(argv) {
  const result = { features: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--feature') result.features.push(argv[++index]);
    else if (arg.startsWith('--') && arg.includes('=')) {
      const [key, value] = arg.slice(2).split(/=(.*)/su, 2);
      result[key] = value;
    } else if (arg.startsWith('--')) result[arg.slice(2)] = argv[++index];
    else throw new Error(`unexpected argument ${arg}`);
  }
  return result;
}

function replaceExactly(text, pattern, replacement, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matches = [...text.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one upstream anchor, found ${matches.length}`);
  }
  return text.replace(pattern, replacement);
}

function ensureChild(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (!resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`refusing target outside ${resolvedRoot}: ${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

function backupName() {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}

const args = parseArgs(process.argv.slice(2));
if (!args.source || !args['dsh-home'] || !args.mode || !args['dsh-version']) {
  throw new Error('required: --source, --dsh-home, --mode, --dsh-version');
}
if (!['lean', 'balanced'].includes(args.mode)) throw new Error('--mode must be lean or balanced');
for (const feature of args.features) {
  if (!['codex', 'claude'].includes(feature)) throw new Error(`unknown feature ${feature}`);
}

const source = resolve(args.source);
if (!existsSync(source) || !lstatSync(source).isDirectory()) {
  throw new Error(`upstream standard preset directory not found: ${source}`);
}
const sourceComposition = join(source, 'agent.cordis.yml');
const sourceMetadata = join(source, 'preset.yml');
if (!existsSync(sourceComposition) || !existsSync(sourceMetadata)) {
  throw new Error(`upstream preset is missing agent.cordis.yml or preset.yml: ${source}`);
}

const dshHome = resolve(args['dsh-home']);
const presetRoot = join(dshHome, '.agent-presets');
const target = ensureChild(presetRoot, join(presetRoot, 'skillopt-standard'));
const markerName = '.dsh-codex-kit.json';
const existingMarker = join(target, markerName);
if (existsSync(target) && !existsSync(existingMarker)) {
  throw new Error(`refusing to overwrite unowned preset: ${target}`);
}

mkdirSync(presetRoot, { recursive: true });
const temporary = `${target}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
rmSync(temporary, { recursive: true, force: true });
cpSync(source, temporary, { recursive: true, errorOnExist: true, force: false });

let composition = readFileSync(join(temporary, 'agent.cordis.yml'), 'utf8');
if (args.mode === 'lean') {
  composition = replaceExactly(
    composition,
    /^(- id: tool-skill\r?\n  name: '@deepseek-ai\/dsh-tool-skill'\r?\n)/mu,
    '$1  disabled: true\n',
    'disable upstream all-skill catalog',
  );
  composition = replaceExactly(
    composition,
    /(^- id: agent-instructions\r?\n  name: '@deepseek-ai\/dsh-agent-instructions'\r?\n  config:\r?\n    maxBytes: )65536/mu,
    (_match, prefix) => `${prefix}32768`,
    'reduce instruction byte budget',
  );
  composition = replaceExactly(
    composition,
    /(    - id: tool-result-pruner\r?\n      name: '@deepseek-ai\/dsh-compaction-tool-result-pruner'\r?\n      config:\r?\n        thresholdChars: )8192(\r?\n        headChars: )4096(\r?\n        tailChars: )1024/mu,
    (_match, thresholdPrefix, headPrefix, tailPrefix) => `${thresholdPrefix}6144${headPrefix}3072${tailPrefix}1024`,
    'apply bounded tool-result pruning',
  );
}

if (args.features.includes('codex')) {
  composition = replaceExactly(
    composition,
    /(^    - id: tool-subagent-codex\r?\n      name: '@deepseek-ai\/dsh-tool-subagent'\r?\n)      disabled: true\r?\n/mu,
    '$1',
    'enable Codex subagent tool',
  );
}
if (args.features.includes('claude')) {
  composition = replaceExactly(
    composition,
    /(^    - id: tool-subagent-claude-code\r?\n      name: '@deepseek-ai\/dsh-tool-subagent'\r?\n)      disabled: true\r?\n/mu,
    '$1',
    'enable Claude Code subagent tool',
  );
}

const sourceHash = createHash('sha256').update(readFileSync(sourceComposition)).digest('hex');
composition = `# Generated from the shipped standard preset by dsh-codex-kit.\n# Re-run the installer after a DSH upgrade; do not assume this snapshot auto-updates.\n${composition}`;
writeFileSync(join(temporary, 'agent.cordis.yml'), composition, 'utf8');

let metadata = readFileSync(join(temporary, 'preset.yml'), 'utf8');
metadata = replaceExactly(metadata, /^name:.*$/mu, `name: SkillOpt ${args.mode === 'lean' ? '轻量' : '兼容'}模式`, 'preset name');
metadata = replaceExactly(
  metadata,
  /^description:.*$/mu,
  args.mode === 'lean'
    ? 'description: 以按需 SkillOpt 取代完整技能目录，并收紧指令与工具结果预算。'
    : 'description: 保留官方标准模式，同时提供 SkillOpt 检索、诊断与渐进式加载。',
  'preset description',
);
writeFileSync(join(temporary, 'preset.yml'), metadata, 'utf8');
writeFileSync(join(temporary, markerName), `${JSON.stringify({
  owner: 'dsh-codex-kit',
  kitVersion: '0.1.0',
  dshVersion: args['dsh-version'],
  mode: args.mode,
  features: [...new Set(args.features)].sort(),
  source: basename(source),
  sourceSha256: sourceHash,
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`, 'utf8');

let backup;
try {
  if (existsSync(target)) {
    backup = join(dshHome, 'backups', 'dsh-codex-kit', `${backupName()}-skillopt-standard`);
    mkdirSync(dirname(backup), { recursive: true });
    cpSync(target, backup, { recursive: true, errorOnExist: true, force: false });
    rmSync(target, { recursive: true, force: false });
  }
  renameSync(temporary, target);
} catch (error) {
  rmSync(temporary, { recursive: true, force: true });
  if (!existsSync(target) && backup && existsSync(backup)) cpSync(backup, target, { recursive: true });
  throw error;
}

console.log(JSON.stringify({ status: 'created', target, backup, mode: args.mode, features: args.features }));
