# Public release checklist

1. Re-run the current npm and official-doc verification commands in `docs/research/SOURCES.md`.
2. Update pins, sizes and snapshot date only after reviewing package/repository changes.
3. Run `npm ci --ignore-scripts`, `npm run check`, and `npm run pack:dry`.
4. Test Windows and POSIX installer dry-runs.
5. Test a real install in a new temporary `DSH_HOME`; do not use a production profile as the first test.
6. Verify `dsh --profile web --dump-config` and `dsh --profile skillopt-headless --dump-config`.
7. Confirm generated preset/profile ownership markers and backup behavior.
8. Run an end-to-end model benchmark before making any quality/token/latency claim.
9. Run `git diff --check`, `npm run check:public`, and review `git ls-files` manually.
10. Tag the exact commit, produce an archive plus SHA-256, and publish release notes with known limitations.
