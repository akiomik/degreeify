#!/usr/bin/env bash
#
# Build the generated Xcode project, without opening Xcode.
#
# Not what a reader of the extension does — that is Run in Xcode, so that
# Safari is told about the app. This is here so that "the project the script
# generates still builds" is one command rather than a thing somebody
# remembers to check, and so that a converter whose output stops compiling is
# found here rather than by whoever next tries to use it.
#
# Unsigned, because nothing is being distributed. Signing is Xcode's business
# when a person runs it there.
set -euo pipefail

cd "$(dirname "$0")/.."

readonly APP_NAME=Degreeify
readonly BUILT=.output/safari-mv3
readonly PROJECT="safari/$APP_NAME/$APP_NAME.xcodeproj"

if [ ! -d "$PROJECT" ]; then
  echo "error: $PROJECT not found. Run 'npm run safari:xcode' first." >&2
  exit 1
fi

# The project names the top-level entries of the built extension one by one,
# and folders among them by reference — so a file added inside `chunks/` or
# `content-scripts/` arrives on its own, and a new top-level file does not. It
# is left out of the built extension with nothing said, which is the kind of
# missing that is found by wondering why a feature does nothing in Safari
# alone.
missing=""
for entry in "$BUILT"/*; do
  name=$(basename "$entry")
  grep -q "$BUILT/$name\"\?;" "$PROJECT/project.pbxproj" || missing="$missing $name"
done

if [ -n "$missing" ]; then
  echo "error: the built extension has entries the Xcode project does not name:" >&2
  for name in $missing; do echo "  $name" >&2; done
  echo "Run 'npm run safari:xcode' to generate the project again." >&2
  exit 1
fi

xcodebuild \
  -project "$PROJECT" \
  -target "$APP_NAME" \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build
