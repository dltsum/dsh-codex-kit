# Architecture and design boundaries

## Stable tool, dynamic data

The plugin registers exactly one tool, `skillopt`, for the lifetime of its Cordis scope. Catalog changes alter data returned by `ctx.skills.snapshot()`, not the visible tool set. This deliberately avoids tool registration churn and makes request-prefix behavior easier to reason about.

`search` flow:

1. Borrow the current agent workspace, signal and scope from the tool execution.
2. Call `ctx.skills.snapshot()` and filter `modelInvocable` entries.
3. Reject catalogs above the configured safety limit.
4. Hash stable routing metadata and reuse an in-process immutable index only for complete snapshots.
5. Score exact-name, name-token, description and `whenToUse` evidence with a deterministic BM25-style function.
6. Return only positive-score rows that fit both the result-count and approximate-token budgets.

`load` repeats current catalog/policy checks, calls `ctx.skills.get()` by exact name, and renders with upstream `renderSkillContent()`. Search results therefore do not act as authorization and stale candidates cannot bypass current invocation policy.

## Why lexical retrieval first

The zero-model path has no network call, embedding dependency, model download, credential, GPU requirement or private-query disclosure. It is explainable and cheap enough to run on every search. It is not claimed to solve semantic skill routing: body-aware and trained retrievers can outperform metadata-only lexical search at large scale. The benchmark contract therefore tracks misses, not just token estimates.

## Why skill bodies are not compressed

Skill bodies often contain exact commands, negative constraints, versions, security boundaries and sequencing rules. Automatic abstractive compression could change intent. The Kit optimizes discovery and selection while preserving the selected body byte-for-byte after provider parsing.

## Lean preset

The Web preset is generated from the exact shipped `standard` preset at installation time. The transformer requires one match for each upstream anchor, so a breaking upstream change stops the install. It never edits the shipped preset.

Lean changes:

- upstream `tool-skill` disabled for that preset;
- `agent-instructions.maxBytes`: 65536 to 32768;
- tool-result pruning: threshold 6144, head 3072, tail 1024;
- optional official Codex/Claude subagent rows enabled only when their packages are explicitly selected.

The host-level Kit bundle remains stable and can read the calling agent's scoped skill registry. Balanced mode keeps upstream catalog and budgets while exposing SkillOpt for comparison.

## Explicit non-goals

- No dynamic MCP/tool hiding. Current public lifecycle and replay seams require more care than a safe out-of-tree default.
- No model-provider configuration or credential management.
- No browser automation.
- No background server, telemetry or remote index.
- No claim that a character-based estimate equals provider token billing.
