# Performance controls

## Controls that are on in lean mode

| Control | Default | Purpose | Main trade-off |
|---|---:|---|---|
| Skill results | 5 | Limit routing candidates | May miss a lower-ranked relevant skill |
| Skill metadata budget | ~600 tokens | Bound search output | Token estimate is tokenizer-independent |
| Description cap | 180 chars | Prevent one skill dominating results | Important routing text may be truncated |
| Catalog safety cap | 5000 | Refuse unexpected index growth | Very large registries need an explicit change |
| Index cache entries | 32 | Reuse complete catalogs | Process-local only |
| Instruction bytes | 32768 | Bound instruction injection | Oversized instructions are excluded upstream |
| Tool prune threshold/head/tail | 6144/3072/1024 chars | Bound old tool output | Middle evidence may be removed |
| Plain-text inline output | 16 KiB default | Keep current-step tool output bounded | Oversized text uses the official spill store |
| Shell/search inline output | 12 KiB | Bound common high-volume tools earlier | Full output must be recovered from the artifact when needed |
| Subagent inline output | 24 KiB | Preserve more structured handoff detail | Larger than the general budget |
| Efficiency ledger queue | 4096 records | Bound local pending writes | Excess records are counted and reported as dropped |

The `recommended-full` installer keeps these lean controls, but its plugins expose more capabilities than the core-only install. Full functionality and minimum prompt/tool footprint are different goals: use the full bundle for a general workstation, and use the core installer plus task-specific plugin ids for the lowest steady-state overhead.

Configuration can override the plugin row in the Profile patch. A Cordis patch replaces a row's complete `config`, so restate all fields:

```yaml
- id: dsh-codex-kit
  config:
    maxResults: 8
    defaultTokenBudget: 900
    descriptionMaxChars: 240
    maxCatalogEntries: 10000
    cacheMaxEntries: 32
```

## Lossless output budgeting

`dsh-output-budget` composes with DSH 0.1.1-rc.2's official spill subsystem. For oversized all-text output, the complete UTF-8 text is first persisted by `ctx.spillStore`; only then is model-facing content replaced with a bounded head/tail preview and deterministic `status`, `summary`, `next_actions`, and `artifacts` lines. Storage failure, missing session ownership, a missing backend, non-text content, or an overlong locator keeps the original inline result and emits a warning.

The canonical tool value is never changed. Nested Code Mode calls are bounded on the durable `tools/code-dispatch-log` copy, so the enclosing program value remains intact. `read` is excluded from the model-facing arm to avoid a read/spill/read loop, and `skillopt` is excluded so a selected Skill body is not silently reduced. DSH's generic 50 kB spill policy remains loaded as a fallback.

Override the complete output-budget row when tuning it; values are UTF-8 bytes and must be integers from 512 through 4 MiB:

```yaml
- id: dsh-codex-kit-output-budget
  config:
    defaultMaxInlineBytes: 16384
    toolMaxInlineBytes:
      bash: 12288
      pwsh: 12288
      grep: 12288
      glob: 12288
      web: 16384
      subagent: 24576
      subagent_fork: 24576
    skipTools: [read, skillopt]
```

## Local efficiency ledger

Each run writes one append-only JSONL file below `$DSH_HOME/metrics/dsh-codex-kit`. It records only numeric and enum metadata: provider/model names, request and schema byte counts, adapter-reported token usage, latency, tool name/status/byte counts, retry/compaction counters, and truncated hashes for session/workspace correlation. It excludes prompt/output text, tool argument/result values, error messages, raw paths, raw session ids, environment values, and credentials. Nothing is transmitted by this plugin.

```powershell
dsh-kit metrics
dsh-kit metrics --json
```

The summary is evidence collection, not an automatic optimization claim. Compare matched baseline/Kit runs under the contract in [BENCHMARK.md](BENCHMARK.md).

## Prefix-cache discipline

Keep a session's tool set and stable instructions unchanged where possible. Plugin enable/disable operations belong between sessions, followed by a restart and a new session. A GitHub discussion reports a route-specific experiment where placing stable injected context after a changing first user prompt sharply reduced cross-session prefix hits. That report is useful evidence, not a universal guarantee across providers.

## Context overflow

Input tokens, tool schemas, injected context and the requested output budget must fit the model window together. Pruning and compaction lower pressure but cannot correct every provider/upstream budgeting bug. Preserve important evidence in files and begin a clean session before the window is exhausted.

## Experimental directions, disabled by default

- Body-aware reranking after lexical candidate generation;
- learned extractive prompt compression with a fidelity test set;
- token-cost-aware multi-skill set selection rather than independent top-k;
- dynamic tool projection once lifecycle, assembly, replay and cache invariants are verified for the targeted DSH release.
