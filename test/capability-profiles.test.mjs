import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITY_PROFILES, capabilityProfile } from '../src/capability-profiles.js';

test('capability profile table is fixed, unique and lookup is fail-closed', () => {
  assert.deepEqual(CAPABILITY_PROFILES.map((profile) => profile.id), ['standard', 'code', 'minimal']);
  assert.equal(new Set(CAPABILITY_PROFILES.map((profile) => profile.targetDirectory)).size, 3);
  assert.equal(capabilityProfile('code').sourceDirectory, 'code');
  assert.equal(capabilityProfile('minimal').supportsSubagentFeatures, false);
  assert.throws(() => capabilityProfile('unknown'), /unknown capability profile/u);
});
