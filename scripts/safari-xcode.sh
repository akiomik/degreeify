#!/usr/bin/env bash
#
# Generate (or refresh) the Xcode project that wraps the extension for Safari.
#
# Run `npm run build:safari` first. The generated `safari/` directory is
# ignored by git: it can always be recreated from this script.
#
# `--copy-resources` is intentionally omitted so the Xcode project keeps
# referencing `.output/safari-mv3`. Rebuilding with `npm run build:safari` is
# then enough to update the extension; the project needs no regeneration.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d .output/safari-mv3 ]; then
  echo "error: .output/safari-mv3 not found. Run 'npm run build:safari' first." >&2
  exit 1
fi

xcrun safari-web-extension-converter .output/safari-mv3 \
  --project-location safari \
  --app-name Degreeify \
  --bundle-identifier com.github.akiomik.degreeify \
  --macos-only \
  --swift \
  --no-open \
  --no-prompt \
  --force
