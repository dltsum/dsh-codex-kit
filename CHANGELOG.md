# Changelog

## Unreleased

- Added a local-first Android controller source tree and a loopback-by-default
  Node bridge for bounded `skillopt-headless` task submission, polling and
  cancellation. The bridge has one-time in-memory pairing, explicit LAN opt-in,
  no arbitrary shell or credential API, and protocol tests.
- Added Flutter bootstrap scripts, Android cleartext-network warning/overlay,
  domain/data/repository/MVVM layers, and Chinese operator documentation.
- Added a self-hosted HTTPS relay and outbound computer Agent for internet
  control without exposing a home-PC inbound port. Device secrets are persisted
  only as hashes; the relay forwards a fixed status/list/submit/get/cancel
  protocol, bounds queues and timeouts, and never automatically replays a
  command after an unknown transport outcome. The Android client now supports
  the HTTPS relay namespace while retaining LAN direct-connect only for testing.
- Added optional Bluetooth BLE onboarding: the Agent can advertise a one-use,
  expiring secure GATT bootstrap, and the Android Central can scan, challenge,
  receive the relay credentials, and continue over HTTPS without manual URL or
  token entry. The native BLE dependency remains an explicit runtime install;
  adapters without Peripheral/GATT Server support use the HTTPS fallback.

## 0.3.0 - 2026-08-28

- Added a local append-only efficiency ledger for model latency, provider token usage, cache usage, tool latency, retries, compactions and outcomes without recording prompts, arguments, results or local paths.
- Added `dsh-kit metrics` for deterministic summaries of the latest local ledger.
- Added per-tool output budgets that retain complete oversized text through DSH's official spill store and replace only model-facing text with a bounded preview and artifact locator.
- Added fixed Standard, Code and Minimal capability presets generated from the matching shipped DSH presets with exact-anchor checks, ownership markers and backups.
- Kept DSH's generic spill policy as a fallback and avoided an agent-loop fork.
- Expanded tests, diagnostics, packaging checks and operator documentation for all three additions.

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
