# Public release checklist

1. Re-run the current npm and official-doc verification commands in `docs/research/SOURCES.md`.
2. Update pins, sizes and snapshot date only after reviewing package/repository changes.
3. Run `npm ci --ignore-scripts`, `npm run check`, and `npm run pack:dry`.
4. Test Windows and POSIX installer dry-runs.
5. Test a real install in a new temporary `DSH_HOME`; do not use a production profile as the first test.
6. Generate `skillopt-standard`, `skillopt-code`, and `skillopt-minimal` from the exact shipped DSH presets and verify all ownership markers.
7. Verify `dsh --profile web --dump-config` and `dsh --profile skillopt-headless --dump-config` load SkillOpt, the efficiency ledger, and output-budget plugins.
8. Exercise one oversized result against a temporary spill backend and confirm the artifact is byte-identical while the preview stays within its tool budget.
9. Confirm a temporary ledger captures usage/latency/counts but none of the sentinel prompt, output, argument, error, path, session-id, or credential strings.
10. Confirm generated preset/profile backup behavior; uninstall must leave credentials, sessions, spill artifacts, and metric ledgers intact.
11. Run an end-to-end model benchmark before making any quality/token/latency claim.
12. Run `git diff --check`, `npm run check:public`, and review `git ls-files` manually.
13. Tag the exact commit, produce an archive plus SHA-256, and publish release notes with known limitations.
