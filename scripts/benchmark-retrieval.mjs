import { performance } from 'node:perf_hooks';
import { buildSkillIndex, estimateCatalogTokens, searchSkillIndex } from '../src/retrieval.js';

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function createCatalog(size) {
  return Array.from({ length: size }, (_, index) => ({
    name: `category-${index % 100}-skill-${index}`,
    description: `Reusable workflow ${index} for category ${index % 100}, testing, files, analysis and verification.`,
    whenToUse: `Use for deterministic benchmark task ${index % 100}.`,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'synthetic-benchmark',
    source: 'custom',
  }));
}

const size = Number(process.argv[2] ?? 5000);
const iterations = Number(process.argv[3] ?? 200);
if (!Number.isInteger(size) || size < 1 || size > 50000) throw new Error('catalog size must be an integer from 1 to 50000');
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10000) throw new Error('iterations must be an integer from 1 to 10000');

const catalog = createCatalog(size);
const beforeIndex = process.memoryUsage().heapUsed;
const buildStart = performance.now();
const index = buildSkillIndex(catalog);
const buildMs = performance.now() - buildStart;
const afterIndex = process.memoryUsage().heapUsed;

const timings = [];
let last;
for (let iteration = 0; iteration < iterations; iteration += 1) {
  const started = performance.now();
  last = searchSkillIndex(index, `category ${iteration % 100} testing`, {
    limit: 5,
    tokenBudget: 600,
    descriptionMaxChars: 180,
  });
  timings.push(performance.now() - started);
}
timings.sort((left, right) => left - right);

console.log(JSON.stringify({
  kind: 'synthetic-local-microbenchmark',
  node: process.versions.node,
  catalogSize: size,
  iterations,
  indexBuildMs: Number(buildMs.toFixed(3)),
  approximateIndexHeapBytes: Math.max(0, afterIndex - beforeIndex),
  searchMs: {
    p50: Number(percentile(timings, 0.50).toFixed(3)),
    p95: Number(percentile(timings, 0.95).toFixed(3)),
    max: Number(timings.at(-1).toFixed(3)),
  },
  estimatedFullCatalogTokens: estimateCatalogTokens(catalog),
  lastResultTokens: last.usedTokens,
  lastResultCount: last.selected.length,
  warning: 'Synthetic lexical latency and heuristic token estimates only; not an end-to-end model or quality benchmark.',
}, null, 2));
