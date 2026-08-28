#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BLUETOOTH_PACKAGE_SPEC = '@stoprocent/bleno@0.11.4';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
function resolveNpm() {
  if (process.platform !== 'win32') return { file: 'npm', args: [] };
  const shim = (process.env.PATH ?? '')
    .split(delimiter)
    .map((directory) => join(directory.replace(/^"|"$/gu, ''), 'npm.cmd'))
    .find(existsSync);
  if (!shim) return undefined;
  const cli = join(dirname(shim), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return existsSync(cli) ? { file: process.execPath, args: [cli] } : undefined;
}

console.log(`Installing optional BLE peripheral support: ${BLUETOOTH_PACKAGE_SPEC}`);
console.log('This native dependency is not part of the core kit and is installed only in the current checkout.');
const npm = resolveNpm();
if (!npm) throw new Error('npm is not installed or its Windows shim cannot be resolved');
const result = spawnSync(npm.file, [...npm.args, 'install', '--no-save', '--no-package-lock', BLUETOOTH_PACKAGE_SPEC], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Optional BLE dependency installed. Start the Agent with --bluetooth to advertise one bootstrap session.');
