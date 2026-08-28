# DSH Codex Kit

Auditable local enhancements for DeepSeek Harness: reproducible installers, progressive skill retrieval, fixed capability presets, lossless output budgets, content-free local efficiency metrics, diagnostics, and an opt-in plugin catalog.

The tested upstream pin is `@deepseek-ai/dsh@0.1.1-rc.2`. DSH is still a developer preview, so this project pins versions instead of silently following `latest`.

## What changes

The upstream `tool-skill` consumer publishes every model-invocable skill name and description before loading one exact skill body. The lean preset disables that full catalog and exposes one stable `skillopt` tool. It performs deterministic local retrieval, returns a budgeted candidate list, and loads the selected skill through the official `ctx.skills` registry without rewriting its instructions.

Version 0.3.0 also adds three immutable Web capability presets (`skillopt-standard`, `skillopt-code`, and `skillopt-minimal`), plus `skillopt-headless`. Oversized plain-text tool output is saved through DSH's official session spill store before a bounded preview is shown to the model. A local append-only ledger records numeric/enum cost and latency fields without prompts, tool arguments/results, paths, credentials, or remote telemetry.

The reported SkillOpt token savings are tokenizer-independent estimates, not billing claims. The new ledger exposes provider-reported usage when the adapter supplies it, but no performance claim is made without a matched baseline. See [the benchmark contract](docs/BENCHMARK.md).

## Install

Requirements: Node.js 22.19+ or 24+, Git, and npm.

Full recommended local workstation (SkillOpt plus pinned vision, memory, multi-agent, subagent, file-context, observability, theme, and Workbench plugins):

```powershell
git clone --depth 1 https://github.com/dltsum/dsh-codex-kit.git
Set-Location .\dsh-codex-kit
powershell -ExecutionPolicy Bypass -File .\install-full.ps1
```

```bash
git clone --depth 1 https://github.com/dltsum/dsh-codex-kit.git
cd dsh-codex-kit
sh ./install-full.sh
```

Large plugin payloads are not committed or bundled; the full installer downloads exact pins at runtime. Provider credentials remain separate. For core-only installation with no optional third-party plugin, use `scripts/install.ps1` or `scripts/install.sh`.

Dry-run:

```powershell
.\install-full.ps1 -DryRun
```

```bash
sh ./install-full.sh --dry-run
```

## Run

```powershell
dsh web --no-open
dsh --profile skillopt-headless "review this repository"
dsh-kit doctor --deep
dsh-kit catalog
dsh-kit metrics
```

After starting Web, manually open `http://127.0.0.1:3080` and select one generated preset for a new session: Standard for general work, Code for a fixed Code Mode tool surface, or Minimal for the official two-group minimal surface. Do not switch capability presets inside a running session if reproducibility matters.

Optional plugins require both explicit ids and risk acceptance:

```powershell
.\scripts\install.ps1 -SkipDsh -Profiles web `
  -Plugins @('modlens', 'context-vista') -AcceptThirdPartyRisk
```

Large plugins are neither committed nor downloaded by default. Exact versions, size snapshots, permissions, and sources live in [the plugin catalog](docs/PLUGIN_CATALOG.zh-CN.md).

## Verify

```powershell
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm run pack:dry
```

## Safety

Generated configuration is ownership-marked and backed up before replacement. The installer refuses to overwrite a same-named unowned preset/profile. Secrets, DSH settings, sessions, memories, models, caches, spill artifacts, local metric ledgers, and optional plugin payloads are excluded from the repository. Uninstall deliberately leaves spill artifacts and metrics in place so it cannot destroy work evidence. See [SECURITY.md](SECURITY.md).

Chinese operator manual: [docs/INSTALLATION.zh-CN.md](docs/INSTALLATION.zh-CN.md). Research ledger: [docs/research/SOURCES.md](docs/research/SOURCES.md).

## License

MIT. DeepSeek Harness and third-party plugins retain their own licenses.
