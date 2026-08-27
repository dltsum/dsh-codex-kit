import { createHash } from 'node:crypto';
import { buildSkillIndex } from './retrieval.js';

export function digestCatalog(skills) {
  const rows = skills
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse ?? '',
      provider: skill.provider ?? '',
      source: skill.source ?? '',
      modelInvocable: Boolean(skill.invocation?.modelInvocable),
    }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export class CatalogIndexCache {
  #entries = new Map();
  #maxEntries;

  constructor(maxEntries = 32) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 256) {
      throw new RangeError('cacheMaxEntries must be an integer from 1 to 256');
    }
    this.#maxEntries = maxEntries;
  }

  get size() {
    return this.#entries.size;
  }

  clear() {
    this.#entries.clear();
  }

  getOrBuild(skills, { cacheable = true } = {}) {
    const digest = digestCatalog(skills);
    const existing = this.#entries.get(digest);
    if (existing) {
      this.#entries.delete(digest);
      this.#entries.set(digest, existing);
      return { digest, index: existing, cacheHit: true };
    }

    const index = buildSkillIndex(skills);
    if (cacheable) {
      this.#entries.set(digest, index);
      while (this.#entries.size > this.#maxEntries) {
        const oldest = this.#entries.keys().next().value;
        this.#entries.delete(oldest);
      }
    }
    return { digest, index, cacheHit: false };
  }
}
