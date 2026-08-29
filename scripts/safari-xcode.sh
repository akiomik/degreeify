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
identifiers=$(
  sed -n 's/.*PRODUCT_BUNDLE_IDENTIFIER = \([^;]*\);.*/\1/p' "$PROJECT/project.pbxproj" |
    sort -u
)
app=$(echo "$identifiers" | head -1)
extension=$(echo "$identifiers" | tail -1)

case "$extension" in
"$app".*) ;;
*)
  echo "error: the extension's identifier is not inside the app's." >&2
  echo "  app:       $app" >&2
  echo "  extension: $extension" >&2
  echo "Xcode will refuse to embed the extension. The converter derives these" >&2
  echo "from --app-name and --bundle-identifier; they have to agree." >&2
  exit 1
  ;;
esac

echo
echo "Generated $PROJECT"
echo "  app:       $app"
echo "  extension: $extension"
