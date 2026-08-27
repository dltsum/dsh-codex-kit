import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', 'node_modules', '.artifacts', '.tmp', 'dist', 'coverage']);
const textExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.sh', '.ts', '.txt', '.yaml', '.yml']);
const secretPatterns = [
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/gu],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/gu],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/gu],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu],
  ['Credential in GitHub URL', /https:\/\/[^\s/@:]+:[^\s/@]+@github\.com/gu],
  ['Local operator path', /C:\\Users\\12164/giu],
];
const failures = [];
let scanned = 0;

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(target);
      continue;
    }
    const size = statSync(target).size;
    const label = relative(root, target);
    if (size > 2 * 1024 * 1024) failures.push(`${label}: file exceeds 2 MiB (${size} bytes)`);
    if (!textExtensions.has(extname(entry.name).toLowerCase()) || size > 5 * 1024 * 1024) continue;
    const text = readFileSync(target, 'utf8');
    scanned += 1;
    for (const [name, pattern] of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) failures.push(`${label}: matched ${name}`);
    }
  }
}

visit(root);
if (failures.length > 0) {
  console.error('Public-repository verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Public-repository verification OK: ${scanned} text files, no oversized files or known secret patterns.`);
