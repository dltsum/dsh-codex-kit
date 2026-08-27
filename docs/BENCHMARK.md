# Benchmark contract

This repository does not turn local unit tests or estimated characters into a quality claim. Before claiming a performance improvement, compare a pinned upstream baseline and the Kit on the same DSH version, model/provider, Skill library, tasks, seed/order, tool set and cache state.

## Minimum matrix

- Modes: upstream standard; Kit balanced; Kit lean.
- Skill-library sizes: small, medium, large; include overlapping names/descriptions.
- Query types: exact name, paraphrase, multilingual, long/noisy, multi-skill and no-relevant-skill.
- Runs: cold prefix/cache and warm prefix/cache reported separately.

## Required metrics

- Retrieval: Hit@1, Recall@5, nDCG@5, false-positive rate, empty-result correctness.
- Execution: task success, wrong-skill execution, tool errors, recovery success.
- Cost: provider-reported input/output/cache-read tokens and monetary cost where available.
- Local estimates: catalog/result estimated tokens reported separately and labelled heuristic.
- Systems: time to first token, end-to-end latency, peak memory and index-build time.

## Acceptance gates for a future release claim

1. Lean mode must reduce provider-reported uncached input tokens on the registered task set.
2. Task success must not regress beyond a pre-registered tolerance.
3. Hidden/non-model-invocable skills must never be returned or loaded.
4. Incomplete snapshots must not poison the cache.
5. Updating a catalog must invalidate the digest and expose the new winner.
6. Results and raw logs must be archived with version/config manifests and secret redaction.

The current unit suite validates deterministic ranking, budgets, policy filtering, canonical loading, cache behavior and catalog pinning. It is not an end-to-end model benchmark.

A reproducible synthetic latency probe is available as `npm run benchmark:retrieval`; its latest local snapshot is [research/LOCAL_MICROBENCHMARK_20260828.md](research/LOCAL_MICROBENCHMARK_20260828.md). It remains outside the quality/Token acceptance claims above.
