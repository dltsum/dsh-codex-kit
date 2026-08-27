import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve, sep } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'));

function invocation(command, args) {
  if (process.platform !== 'win32' || !['npm', 'pnpm', 'dsh'].includes(command)) return { file: command, args };
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
  return existsSync(scripts[command]) ? { file: process.execPath, args: [scripts[command], ...args] } : undefined;
}

function ownedTarget(target) {
  const resolved = resolve(target);
  if (!resolved.startsWith(`${dshHome}${sep}`)) throw new Error(`refusing target outside DSH_HOME: ${resolved}`);
  return existsSync(join(resolved, '.dsh-codex-kit.json'));
}

function run(command, args) {
  console.log(`${dryRun ? '[dry-run]' : '[run]'} ${command} ${args.join(' ')}`);
  if (dryRun) return;
  const resolved = invocation(command, args);
  if (!resolved) throw new Error(`${command} is not installed or its Windows shim cannot be resolved`);
  const result = spawnSync(resolved.file, resolved.args, { stdio: 'inherit', windowsHide: true, env: { ...process.env, DSH_HOME: dshHome } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

const webPackage = join(dshHome, 'profiles', 'web', 'package.json');
if (existsSync(webPackage)) run('dsh', ['plugin', '--profile', 'web', 'remove', 'dsh-codex-kit']);

const targets = [
  join(dshHome, '.agent-presets', 'skillopt-standard'),
  join(dshHome, 'profiles', 'skillopt-headless'),
];
for (const target of targets) {
  if (!existsSync(target)) continue;
  if (!ownedTarget(target)) throw new Error(`refusing to remove unowned path: ${target}`);
  const backup = join(dshHome, 'backups', 'dsh-codex-kit', `${new Date().toISOString().replace(/[:.]/gu, '-')}-uninstall-${target.split(/[\\/]/u).at(-1)}`);
  console.log(`${dryRun ? '[dry-run]' : '[backup]'} ${target} -> ${backup}`);
  if (!dryRun) {
    mkdirSync(dirname(backup), { recursive: true });
    cpSync(target, backup, { recursive: true, filter: (source) => !source.split(/[\\/]/u).includes('node_modules') });
    rmSync(target, { recursive: true, force: false });
  }
}
run('npm', ['uninstall', '-g', 'dsh-codex-kit']);
console.log('Uninstall complete. Optional third-party plugins and DSH itself were left untouched.');
