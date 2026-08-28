# Changelog

## 0.2.0 - 2026-08-28

- Added root-level Windows and POSIX one-click installers for an explicit `recommended-full` bundle.
- Added a machine-readable, pinned full-workstation bundle covering discovery, themes, multimodal support, memory, teams, Codex/Claude subagents, file context, token observability and Workbench.
- Kept large plugin payloads out of Git and release archives; they are downloaded only while the full installer runs.
- Added bundle validation, payload-plan reporting, deterministic completion output and tests for overlapping alternatives.

## 0.1.0 - 2026-08-28

- Added deterministic, multilingual BM25-style SkillOpt retrieval with token-budgeted metadata.
- Added exact-name loading through the official DSH skill registry and canonical skill renderer.
- Added lean Web preset and Headless profile generators with ownership markers and backups.
- Added Windows PowerShell, POSIX shell, dry-run, diagnostics and uninstall flows.
- Added a pinned, opt-in plugin catalog with size and permission notes.
- Added public-repository secret/large-file checks, unit tests, benchmark contract and research ledger.
