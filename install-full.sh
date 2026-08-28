#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s\n' 'DSH Codex Kit: full recommended bundle'
printf '%s\n' 'This explicit entry point installs pinned third-party plugins at runtime.'
exec node "$SCRIPT_DIR/scripts/install-core.mjs" \
  --bundle recommended-full \
  --accept-third-party-risk \
  "$@"
