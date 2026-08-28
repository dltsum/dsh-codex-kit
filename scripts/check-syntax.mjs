import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['bin', 'remote', 'scripts', 'src', 'test'];
const files = [];

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const target = join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (['.js', '.mjs'].includes(extname(entry.name))) files.push(target);
  }
}

for (const directory of roots.map((name) => join(root, name))) visit(directory);
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Syntax OK: ${files.length} JavaScript files.`);
