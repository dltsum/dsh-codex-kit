# DSH Codex Kit

Auditable local enhancements for DeepSeek Harness: reproducible installers, progressive skill retrieval, context budgets, lean presets, diagnostics, and an opt-in plugin catalog.

The tested upstream pin is `@deepseek-ai/dsh@0.1.1-rc.2`. DSH is still a developer preview, so this project pins versions instead of silently following `latest`.

## What changes

The upstream `tool-skill` consumer publishes every model-invocable skill name and description before loading one exact skill body. The lean preset disables that full catalog and exposes one stable `skillopt` tool. It performs deterministic local retrieval, returns a budgeted candidate list, and loads the selected skill through the official `ctx.skills` registry without rewriting its instructions.

The reported token savings are tokenizer-independent estimates, not billing claims. See [the benchmark contract](docs/BENCHMARK.md).

## Install

Requirements: Node.js 22.19+ or 24+, Git, and npm.

```powershell
git clone --depth 1 https://github.com/dltsum/dsh-codex-kit.git
Set-Location .\dsh-codex-kit
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

```bash
git clone --depth 1 https://github.com/dltsum/dsh-codex-kit.git
cd dsh-codex-kit
sh ./scripts/install.sh
```

The default installs no optional third-party plugin. It does not launch a browser, Web server, or model request.

Dry-run:

```powershell
.\scripts\install.ps1 -DryRun
```

```bash
sh ./scripts/install.sh --dry-run
```

## Run

```powershell
dsh web --no-open
dsh --profile skillopt-headless "review this repository"
dsh-kit doctor --deep
dsh-kit catalog
```

After starting Web, manually open `http://127.0.0.1:3080` and select the generated `SkillOpt` preset for a new session.

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

Generated configuration is ownership-marked and backed up before replacement. The installer refuses to overwrite a same-named unowned preset/profile. Secrets, DSH settings, sessions, memories, models, caches, and optional plugin payloads are excluded. See [SECURITY.md](SECURITY.md).

Chinese operator manual: [docs/INSTALLATION.zh-CN.md](docs/INSTALLATION.zh-CN.md). Research ledger: [docs/research/SOURCES.md](docs/research/SOURCES.md).

## License

MIT. DeepSeek Harness and third-party plugins retain their own licenses.
