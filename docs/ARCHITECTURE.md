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

## Stable capability profiles

The Web presets are generated from the exact shipped `standard`, `code`, and
`minimal` presets at installation time. Selection happens between sessions;
the Kit does not dynamically add or remove tools during a request. The
transformer requires exact upstream anchors, so a breaking upstream change
stops the install. It never edits a shipped preset.

Lean changes:

- upstream `tool-skill` disabled for that preset;
- `agent-instructions.maxBytes`: 65536 to 32768;
- tool-result pruning: threshold 6144, head 3072, tail 1024;
- optional official Codex/Claude subagent rows enabled only when their packages are explicitly selected.

The host-level Kit bundle remains stable and can read the calling agent's scoped skill registry. Balanced mode keeps upstream catalog and budgets while exposing SkillOpt for comparison.

## Local efficiency ledger

`dsh-codex-kit/efficiency-ledger` observes the official `llm/stream`,
`tools/execute`, agent, and durable session event seams. It writes one private
append-only JSONL file per process under `$DSH_HOME/metrics/dsh-codex-kit`.
Records contain counts, timings, enums, provider/model names, and truncated
SHA-256 identifiers. The projection never writes prompt/message text, tool
arguments/results, environment values, session ids, or workspace paths.

The writer is non-blocking on the agent hot path and has a bounded pending
record count. Overload is recorded as `ledger_drop` during clean shutdown.
`dsh-kit metrics` summarizes the latest file without turning local estimates
into a performance claim.

## Per-tool output budgets

`dsh-codex-kit/output-budget` composes with DSH's official `ctx.spillStore`.
Oversized plain text is saved verbatim to the configured private spill backend;
only the model-facing content (or Code Mode's durable dispatch-log copy) is
replaced with a bounded head/tail preview and deterministic
`status/summary/next_actions/artifacts` notice. Canonical tool values are never
rewritten. Missing ownership, backend failure, mixed content, and an oversized
locator all keep the original result visible and log a warning.

The upstream generic 50 kB spill policy remains mounted as a fallback. The Kit
adds smaller task-oriented budgets rather than reimplementing storage.

## Explicit non-goals

- No dynamic MCP/tool hiding. Current public lifecycle and replay seams require more care than a safe out-of-tree default.
- No model-provider configuration or credential management.
- No browser automation.
- No remote telemetry, collector, background server, or remote index.
- No claim that a character-based estimate equals provider token billing.
