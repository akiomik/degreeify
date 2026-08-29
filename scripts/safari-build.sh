#!/usr/bin/env bash
#
# Build the generated Xcode project, without opening Xcode.
#
# Not what a reader of the extension does — that is Run in Xcode, so that
# Safari is told about the app. This is here so that checking the generated
# project still compiles is one command. Nothing runs it for you: the Xcode
# build is not in CI, which is a deliberate choice about what a macOS runner
# costs against a PoC that is verified by hand anyway.
#
# Unsigned, because nothing is being distributed. Signing is Xcode's business
# when a person runs it there.
set -euo pipefail
shopt -s nullglob

cd "$(dirname "$0")/.."

readonly APP_NAME=Degreeify
readonly BUILT=.output/safari-mv3
readonly PROJECT="safari/$APP_NAME/$APP_NAME.xcodeproj"

if [ ! -d "$BUILT" ]; then
  echo "error: $BUILT not found. Run 'npm run build:safari' first." >&2
  exit 1
fi

# The file rather than the directory around it. A conversion that was
# interrupted leaves the one without the other, and every check below then
# fails on a file that is not there — six entries reported missing, with the
# reason for each printed by grep.
if [ ! -f "$PROJECT/project.pbxproj" ]; then
  echo "error: $PROJECT/project.pbxproj not found." >&2
  echo "Run 'npm run safari:xcode' to generate the project." >&2
  exit 1
fi

# The wrapper's own icon, which is the one thing the converter copies rather
# than references: it takes the largest icon the manifest declares at
# generation time and builds the app's icon set from it. Changing the icon
# therefore changes what Safari shows for the extension and leaves the app
# showing the old one, and the entry check below cannot see it because `icon/`
# is still named.
#
# Asked of the manifest rather than named here. Written out, this would be the
# size that happens to be the largest today — and the day somebody adds a
# bigger one it would compare the wrapper against an icon the converter did
# not use, fail every time, and send them to regenerate a project that fails
# the same way. A check nothing can satisfy stops a change that was fine.
readonly WRAPPER_ICON="safari/$APP_NAME/$APP_NAME/Resources/Icon.png"

largest=$(
  node -e '
    const { readFileSync } = require("node:fs");
    const icons = JSON.parse(readFileSync(process.argv[1], "utf8")).icons ?? {};
    const sizes = Object.keys(icons).map(Number).filter((size) => Number.isFinite(size));
    process.stdout.write(sizes.length === 0 ? "" : icons[String(Math.max(...sizes))]);
  ' "$BUILT/manifest.json"
)

# Nothing to compare where the manifest declares no icon, which is a build the
# converter takes no icon from either.
if [ -n "$largest" ]; then
  # Both read before either is compared, so that a missing one says which, the
  # way the project file above does. `cmp` answers "these differ" and "I could
  # not read one of them" with the same silence.
  if [ ! -f "$WRAPPER_ICON" ]; then
    echo "error: $WRAPPER_ICON not found." >&2
    echo "Run 'npm run safari:xcode' to generate the project again." >&2
    exit 1
  fi

  if [ ! -f "$BUILT/$largest" ]; then
    echo "error: the manifest declares $largest and the build does not have it." >&2
    echo "Run 'npm run build:safari' first." >&2
    exit 1
  fi

  if ! cmp -s "$WRAPPER_ICON" "$BUILT/$largest"; then
    echo "error: the app's icon is not the one in the build." >&2
    echo "  $WRAPPER_ICON" >&2
    echo "  $BUILT/$largest" >&2
    echo "The converter copies that icon rather than referencing it. Run" >&2
    echo "'npm run safari:xcode' to generate the project again." >&2
    exit 1
  fi
fi

# The project names the top-level entries of the build one by one, and folders
# among them by reference — so a file added inside `chunks/` or
# `content-scripts/` arrives on its own, and a new top-level file does not. It
# is in the build and missing from the app Xcode assembles, with nothing said,
# which is the kind of missing that is found by wondering why a feature does
# nothing in Safari alone.
missing=()
for entry in "$BUILT"/*; do
  name=$(basename "$entry")
  # Fixed strings, and the punctuation the project file writes after a path,
  # so that a name is matched whole and no character in one is read as a
  # pattern. Quoted or not depending on what the name needs, so both.
  grep -qF "$BUILT/$name\";" "$PROJECT/project.pbxproj" ||
    grep -qF "$BUILT/$name;" "$PROJECT/project.pbxproj" ||
    missing+=("$name")
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "error: the build has entries the Xcode project does not name:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo "They would be left out of the app it assembles. Run" >&2
  echo "'npm run safari:xcode' to generate the project again." >&2
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
