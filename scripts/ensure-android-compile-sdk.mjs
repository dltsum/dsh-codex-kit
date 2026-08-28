#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [join(root, 'mobile', 'android', 'app', 'build.gradle'), join(root, 'mobile', 'android', 'app', 'build.gradle.kts')];
const target = candidates.find((file) => existsSync(file));
if (!target) throw new Error('Android app Gradle file not found; run flutter create in mobile first.');

const before = readFileSync(target, 'utf8');
let changed = false;
let found = false;
let after = before.replace(/compileSdk\s*=\s*flutter\.compileSdkVersion/gu, () => {
  found = true;
  changed = true;
  return 'compileSdk = 37';
});
after = after.replace(/compileSdkVersion\s+flutter\.compileSdkVersion/gu, () => {
  found = true;
  changed = true;
  return 'compileSdkVersion 37';
});
after = after.replace(/compileSdk\s*=\s*(\d+)/gu, (match, value) => {
  found = true;
  if (Number(value) < 37) {
    changed = true;
    return 'compileSdk = 37';
  }
  return match;
});
after = after.replace(/compileSdkVersion\s+(\d+)/gu, (match, value) => {
  found = true;
  if (Number(value) < 37) {
    changed = true;
    return 'compileSdkVersion 37';
  }
  return match;
});
if (!found) throw new Error(`Could not find a compileSdk setting in ${target}; inspect it and set compileSdk to at least 37 for permission_handler 13.0.1.`);
if (changed) writeFileSync(target, after, 'utf8');
console.log(`Android compileSdk is at least 37: ${target}`);
