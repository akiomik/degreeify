#!/usr/bin/env bash
#
# Generate (or refresh) the Xcode project that wraps the extension for Safari.
#
# Run `npm run build:safari` first. The generated `safari/` directory is
# ignored by git: it can always be recreated from this script.
#
# `--copy-resources` is intentionally omitted so the Xcode project keeps
# referencing `.output/safari-mv3`. Rebuilding with `npm run build:safari` is
# then enough to change what the next Xcode build picks up.
#
# Two changes still need the project generated again: an icon, which the
# converter copies rather than references, and a new top-level entry in the
# build, which it names one by one. `scripts/safari-xcodebuild.sh` refuses to
# build past either.
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/safari-common.sh
. scripts/safari-common.sh


if [ ! -d "$BUILT" ]; then
  echo "error: $BUILT not found. Run 'npm run build:safari' first." >&2
  exit 1
fi

xcrun safari-web-extension-converter "$BUILT" \
  --project-location safari \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only \
  --swift \
  --no-open \
  --no-prompt \
  --force

# Read only where there is something to read. Without this the message below
# about the converter having moved the identifiers is unreachable in the case
# it describes — a converter that writes the project somewhere else gets a
# bare error from `sed` instead, and the record of what the icons were is
# never written, so the next build reports that missing rather than this.
if [ ! -f "$PROJECT/project.pbxproj" ]; then
  echo "error: $PROJECT/project.pbxproj not found after conversion." >&2
  echo "The converter has put the project somewhere else; this script needs" >&2
  echo "rewriting against what it does now." >&2
  exit 1
fi

# Written as soon as the project exists, before anything that can refuse it.
# The record says what the project was made from, and by this point it was
# made — so a check below stopping the script would otherwise leave the record
# describing the run before this one, and the builder would report that the
# icons had changed when the project already matches them, sending the reader
# to regenerate what they have. Which is the misdiagnosis this record was
# rearranged once already to avoid.
#
# Worked out and then written, rather than written as it is worked out. A
# redirection empties the file before the command behind it runs, so a digest
# that fails would leave a record of nothing — which reads as a project made
# from no icons at all.
if ! record=$(icons_digest); then
  echo "error: the project was generated, but what its icons were could not" >&2
  echo "be recorded, so nothing can tell later whether they have changed." >&2
  exit 1
fi

printf '%s' "$record" > "$ICONS_RECORD"

# Asked of what was generated rather than assumed from what was asked for. The
# rule above is the converter's and could change under us; read back, a change
# to it is this message rather than an Xcode build failing on a validation
# nobody was looking for.
#
# Quotes taken off, because the project file puts them round any identifier
# that needs them and a hyphen in an org name is enough to need them. Left on,
# every comparison below is against a value no identifier can equal, and the
# check fails on projects that are perfectly good.
identifiers=$(
  sed -n 's/.*PRODUCT_BUNDLE_IDENTIFIER = \([^;]*\);.*/\1/p' "$PROJECT/project.pbxproj" |
    tr -d '"' | sort -u
)

if [ -z "$identifiers" ]; then
  echo "error: the project names no bundle identifiers at all." >&2
  echo "The converter has changed where it writes them; this check needs" >&2
  echo "rewriting against what it does now." >&2
  exit 1
fi

if [ "$(echo "$identifiers" | wc -l)" -ne 2 ]; then
  echo "error: expected the project to name two bundle identifiers, and it names:" >&2
  echo "$identifiers" | while IFS= read -r one; do echo "  $one" >&2; done
  exit 1
fi

first=$(echo "$identifiers" | head -1)
second=$(echo "$identifiers" | tail -1)

# Which of the two is the app is read off the nesting rather than off the order
# they came back in. Sorted, either can come first — and where they do not nest
# at all, which is what this is here for, neither name is worth claiming: a
# message that labels them by position labels them wrongly exactly when
# somebody is relying on it.
if [ "${second#"$first".}" != "$second" ]; then
  app=$first
  extension=$second
elif [ "${first#"$second".}" != "$first" ]; then
  app=$second
  extension=$first
else
  echo "error: the two bundle identifiers do not nest:" >&2
  echo "  $first" >&2
  echo "  $second" >&2
  echo "Xcode embeds an extension only where the app's identifier is a prefix" >&2
  echo "of it. The converter derives both from --app-name and" >&2
  echo "--bundle-identifier; they have to agree." >&2
  exit 1
fi


echo
echo "Generated $PROJECT"
echo "  app:       $app"
echo "  extension: $extension"
