# Security policy

## Trust model

`SKILL.md` files are instructions. DSH plugins are executable code loaded into the Harness host. MCP servers and model providers add separate processes or network boundaries. Treating these three categories as equally trusted is a serious configuration error.

The default installation trusts only the pinned DSH package and this repository. No optional plugin is installed until its catalog id is named and `--accept-third-party-risk` / `-AcceptThirdPartyRisk` is present.

## Data that must never enter this repository

- API keys, PATs, cookies, provider replies, SSH material, credential stores;
- `$DSH_HOME/settings.yaml`, session logs, memories, prompts, transcripts, caches, or model data;
- generated plugin payloads and large binaries;
- absolute operator-specific local paths.

Run `npm run check:public` before every public push. It is a guardrail, not a substitute for review.

## Installer guarantees and limits

- Exact DSH and plugin versions are used; moving `latest`, `main`, and `master` specs are rejected by tests.
- Generated preset/profile directories carry `.dsh-codex-kit.json`. Existing unowned directories are never overwritten or deleted.
- Owned configuration is backed up under `$DSH_HOME/backups/dsh-codex-kit/` before replacement or uninstall.
- `--dry-run` prints intended commands without writes.
- The installer does not start DSH Web, a browser, a model call, or an MCP server.
- npm/pnpm lifecycle scripts are disabled for the Kit's global install, but optional DSH plugins may have their own package lifecycle behavior. Review the package before opting in.

## Plugin review checklist

1. Confirm repository ownership, license, release/tag and exact package version.
2. Read `package.json`, `cordis.patch.yml`, install scripts and network/credential code.
3. Record filesystem, process, network, credential and model-spend permissions.
4. Test in a separate `DSH_HOME` first.
5. Run `dsh --profile <profile> --dump-config` and verify the expected rows only.
6. Keep a removal command and configuration backup.

## Reporting

Open a GitHub security advisory for this repository. Do not paste active credentials into an issue. If a credential ever appears in logs or Git history, revoke it first; removing the text alone does not make the credential safe again.
