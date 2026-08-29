#!/usr/bin/env bash
#
# Generate (or refresh) the Xcode project that wraps the extension for Safari.
#
# Run `npm run build:safari` first. The generated `safari/` directory is
# ignored by git: it can always be recreated from this script.
#
# `--copy-resources` is intentionally omitted so the Xcode project keeps
# referencing `.output/safari-mv3`. Rebuilding with `npm run build:safari` is
# then enough to change what the next Xcode build picks up; the project itself
# never needs regenerating.
set -euo pipefail

cd "$(dirname "$0")/.."

readonly APP_NAME=Degreeify
readonly BUNDLE_PREFIX=com.github.akiomik

# Derived from the app name rather than written out, because the converter will
# not let the two disagree. It reads `--bundle-identifier` as the extension's
# base and builds the app's own from this prefix plus the app name — so unless
# the last component is exactly the app name, the app ends up with an
# identifier that is not a prefix of its extension's, and Xcode refuses to
# embed one binary in another it does not contain. That failure arrives at
# build time in Xcode, several steps after the mistake.
readonly BUNDLE_ID="$BUNDLE_PREFIX.$APP_NAME"

readonly BUILT=.output/safari-mv3
readonly PROJECT="safari/$APP_NAME/$APP_NAME.xcodeproj"

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
