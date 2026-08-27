# DeepSeek Harness current-state snapshot

Snapshot date: 2026-08-28. Facts that can drift are intentionally paired with reproduction commands.

## Version and maturity

```powershell
npm view @deepseek-ai/dsh version dist-tags time --json
dsh --version
```

At the snapshot, the npm `latest` for the CLI was `0.1.1-rc.2` (published 2026-08-21). The official repository calls DSH a developer preview and explicitly warns about compatibility-breaking changes. The Kit therefore pins the complete release candidate string.

The official Codex and Claude Code subagent packages had an unusual registry state: `latest=0.0.1-rc.1`, while `next=0.1.1-rc.2`. The aligned release exists and is installed only through the exact `0.1.1-rc.2` spec. Never infer compatibility from `latest` alone during the preview.

## Profile and bundle model

A Profile is an ordered list of DSH bundles plus a user patch. A package declares its bundle patch under:

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

Installation is per Profile:

```powershell
dsh plugin --profile web add package@version
dsh --profile web --dump-config
```

The Kit uses the public mechanism and never edits DSH's installed package files.

## Skill subsystem

The official `ctx.skills` registry merges host and per-scope providers. Relevant operations are:

- `snapshot({cwd, signal, scope})`: summaries plus completeness;
- `list(...)`: current winning summaries;
- `get(name, ...)`: the current full definition;
- `isModelInvocable(...)`: model policy boundary;
- `renderSkillContent(...)`: canonical model-facing wrapper.

The official `tool-skill` consumer already hides bodies until exact-name load, but still publishes every invocable name and description as a session catalog. SkillOpt changes discovery, not the provider registry.

## Web agent presets

Shipped presets live under the DSH install; user-authored copies live under `$DSH_HOME/.agent-presets/<id>`. A copied preset is a snapshot. It must be regenerated after upstream changes; editing the shipped file would be overwritten by an upgrade and can break all sessions.

The Web host owns process-wide registries and routes. The selected Preset owns model-facing tools and Skill providers for its scope. This is why the Kit's host tool can read `exec.agent` and query the matching scoped Skill view, while disabling `tool-skill` must happen in the generated Preset.

## Compaction and instruction budgets

Upstream standard values observed in the shipped `standard` preset:

- `agent-instructions.maxBytes: 65536`;
- tool-result pruner `thresholdChars: 8192`, `headChars: 4096`, `tailChars: 1024`.

Lean values are deliberately more conservative. They are reversible policy choices, not upstream fixes.

## Known boundaries that this repository does not pretend to fix

- Full progressive tool/MCP activation has lifecycle, authoritative-catalog, atomicity, prompt-assembly and replay issues. The Kit keeps a stable tool set and only retrieves Skills.
- Prefix-cache behavior depends on provider and message ordering. Reducing injected directory text helps context size, but a universal cache-hit claim would require provider-specific measurement.
- Context-window failures may combine input size and fixed output budgets. Local pruning is containment, not a correction to every upstream/model adapter.
- Token-meter reports and local character estimates must be kept separate from provider billing records.

See [SOURCES.md](SOURCES.md) for the exact official pages and forum threads.
