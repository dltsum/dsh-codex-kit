# Security policy

## Trust model

`SKILL.md` files are instructions. DSH plugins are executable code loaded into the Harness host. MCP servers and model providers add separate processes or network boundaries. Treating these three categories as equally trusted is a serious configuration error.

The core installation trusts only the pinned DSH package and this repository. No optional plugin is installed until its catalog id or a named reviewed bundle is selected and `--accept-third-party-risk` / `-AcceptThirdPartyRisk` is present. Running `install-full.ps1` or `install-full.sh` is the explicit opt-in to the fixed `recommended-full` bundle; it is not the core default.

## Data that must never enter this repository

- API keys, PATs, cookies, provider replies, SSH material, credential stores;
- `$DSH_HOME/settings.yaml`, session logs, memories, prompts, transcripts, caches, or model data;
- generated plugin payloads and large binaries;
- absolute operator-specific local paths.

The local efficiency ledger intentionally stores only numeric/enum metadata and
truncated hashes. It must never be changed to capture prompt, message, argument,
result, environment, session-id, or workspace-path content.

Run `npm run check:public` before every public push. It is a guardrail, not a substitute for review.

## Installer guarantees and limits

- Exact DSH and plugin versions are used; moving `latest`, `main`, and `master` specs are rejected by tests.
- Generated preset/profile directories carry `.dsh-codex-kit.json`. Existing unowned directories are never overwritten or deleted.
- Owned configuration is backed up under `$DSH_HOME/backups/dsh-codex-kit/` before replacement or uninstall.
- `--dry-run` prints intended commands without writes.
- The installer does not start DSH Web, a browser, a model call, or an MCP server.
- The full bundle never contains provider credentials. Vision, Memory, Teams, Codex and Claude capabilities may remain inactive until their separate providers are configured.
- npm/pnpm lifecycle scripts are disabled for the Kit's global install, but optional DSH plugins may have their own package lifecycle behavior. Review the package before opting in.
- Oversized tool text saved by `ctx.spillStore` can contain private source data. Spill files and local metric ledgers stay outside this repository; uninstall deliberately leaves them intact rather than deleting user evidence without instruction.
- The optional Android remote bridge is loopback-only by default. LAN binding requires an explicit `--allow-lan` flag and a one-time in-memory pairing token. It exposes only the fixed headless task API, keeps bounded output in memory, and must not be port-forwarded to the public internet. Its current LAN transport is HTTP; use a trusted VPN or SSH tunnel when encryption is required.
- Internet control uses `remote/relay-server.mjs` plus the outbound `remote/agent.mjs`. The relay requires HTTPS (direct TLS or an HTTPS reverse proxy) before a non-loopback bind is allowed; the computer Agent never needs a public inbound port. The relay persists only SHA-256 device-token hashes, but it can see task text and bounded output while forwarding commands, so run it on a self-managed or explicitly trusted host. Re-registration invalidates the old Agent/phone sessions and rejects queued work instead of replaying it. The phone and Agent expose only the fixed `status`, `list`, `submit`, `get`, and `cancel` actions; no arbitrary shell, `cwd`, file upload, provider credential, or plugin-install path is exposed.
- Bluetooth onboarding is an optional, short-lived BLE GATT peripheral on the computer. The advertisement and info characteristic never contain the phone token; the Android app sends a fresh random challenge over secure read/write characteristics, and the token is returned once only after that exchange. The session expires by default after 120 seconds and stops advertising after one successful response. `@stoprocent/bleno` is a native executable dependency installed only by `npm run remote:bluetooth-install`; review the adapter/driver and package provenance before enabling it. Bluetooth is not an Internet transport, and a device that cannot provide BLE Peripheral/GATT Server must use the HTTPS manual fallback.

## Plugin review checklist

1. Confirm repository ownership, license, release/tag and exact package version.
2. Read `package.json`, `cordis.patch.yml`, install scripts and network/credential code.
3. Record filesystem, process, network, credential and model-spend permissions.
4. Test in a separate `DSH_HOME` first.
5. Run `dsh --profile <profile> --dump-config` and verify the expected rows only.
6. Keep a removal command and configuration backup.

## Reporting

Open a GitHub security advisory for this repository. Do not paste active credentials into an issue. If a credential ever appears in logs or Git history, revoke it first; removing the text alone does not make the credential safe again.
