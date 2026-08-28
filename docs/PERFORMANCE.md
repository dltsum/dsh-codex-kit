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

## Prefix-cache discipline

Keep a session's tool set and stable instructions unchanged where possible. Plugin enable/disable operations belong between sessions, followed by a restart and a new session. A GitHub discussion reports a route-specific experiment where placing stable injected context after a changing first user prompt sharply reduced cross-session prefix hits. That report is useful evidence, not a universal guarantee across providers.

## Context overflow

Input tokens, tool schemas, injected context and the requested output budget must fit the model window together. Pruning and compaction lower pressure but cannot correct every provider/upstream budgeting bug. Preserve important evidence in files and begin a clean session before the window is exhausted.

## Experimental directions, disabled by default

- Body-aware reranking after lexical candidate generation;
- learned extractive prompt compression with a fidelity test set;
- token-cost-aware multi-skill set selection rather than independent top-k;
- dynamic tool projection once lifecycle, assembly, replay and cache invariants are verified for the targeted DSH release.
