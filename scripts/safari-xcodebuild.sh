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

# shellcheck source=scripts/safari-common.sh
. scripts/safari-common.sh

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

# Whether the icons have changed since the project was made from them. The
# converter copies them in at generation, so a change to any of them leaves
# the app showing something the build no longer contains — and the entry check
# below cannot see it, because `icon/` is still named.
#
# Compared as one line recorded at generation rather than icon by icon: what
# the converter puts in the app is re-encoded and never matches a source file
# byte for byte.
if [ ! -f "$BUILT/manifest.json" ]; then
  echo "error: $BUILT/manifest.json not found. Run 'npm run build:safari' first." >&2
  exit 1
fi

# Empty counts as absent. A record with nothing in it says the project was
# made from no icons, which is not a thing that happens — so whatever left it
# that way, the answer is the same and it is not "your icons changed".
if [ ! -s "$ICONS_RECORD" ]; then
  echo "error: $ICONS_RECORD is missing or empty, so what the project was" >&2
  echo "made from is unknown. Run 'npm run safari:xcode' again and read what" >&2
  echo "it says: a generation that could not record this says why, and this" >&2
  echo "is what it leaves behind." >&2
  exit 1
fi

recorded=$(cat "$ICONS_RECORD")
current=$(icons_digest) || exit 1

if [ "$recorded" != "$current" ]; then
  echo "error: the icons have changed since the project was generated." >&2
  echo "The converter copies them rather than referencing them, so the app" >&2
  echo "still shows the old ones. Run 'npm run safari:xcode' to generate the" >&2
  echo "project again." >&2
  exit 1
fi

# The project names the top-level entries of the build one by one, and folders
# among them by reference — so a file added inside `chunks/` or
# `content-scripts/` arrives on its own, and a new top-level file does not. It
# is in the build and missing from the app Xcode assembles, with nothing said,
# which is the kind of missing that is found by wondering why a feature does
# nothing in Safari alone.
# Dotted entries are the converter's limit rather than a project gone out of
# date: asked to wrap a build containing `.DS_Store` or `.well-known` it names
# neither, so regenerating never carries one in. They are said separately for
# that reason — the remedy for the rest is to generate the project again, and
# for these there is none.
#
# Except `.DS_Store`, which macOS writes into any folder somebody opens in
# Finder and which no extension has ever needed. Reported, it would stop the
# build on every machine where that had happened, which is the shape of the
# noise that gets a check deleted.
carried=()
for entry in "$BUILT"/.*; do
  name=$(basename "$entry")
  case "$name" in
  . | .. | .DS_Store) continue ;;
  *) carried+=("$name") ;;
  esac
done

if [ ${#carried[@]} -gt 0 ]; then
  echo "error: the build has entries the converter cannot carry:" >&2
  printf '  %s\n' "${carried[@]}" >&2
  echo "It names no dotted entry in the project, so they would be missing" >&2
  echo "from the app and generating it again would not change that. This" >&2
  echo "build cannot be wrapped for Safari as it stands." >&2
  exit 1
fi

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

# And the other way round, which needs the project generated again just as
# much: an entry it names and the build no longer has — an entrypoint removed
# or renamed. Left to Xcode this is a build that stops on a file it cannot
# copy, naming a path in `.output` and nothing about the project being the
# thing out of date.
gone=()
while IFS= read -r name; do
  [ -e "$BUILT/$name" ] || gone+=("$name")
done < <(sed -n 's|.*/safari-mv3/\([^"]*\)";.*|\1|p' "$PROJECT/project.pbxproj" | sort -u)

if [ ${#gone[@]} -gt 0 ]; then
  echo "error: the Xcode project names entries the build no longer has:" >&2
  printf '  %s\n' "${gone[@]}" >&2
  echo "Xcode will stop on the first of them. Run 'npm run safari:xcode' to" >&2
  echo "generate the project again." >&2
  exit 1
fi

# Built somewhere the generator does not wipe. Left in the default place,
# inside `safari/`, building registers an app with the system at a path the
# next `--force` regeneration deletes — and the reader is left with a
# registration pointing at nothing, in the one flow whose whole purpose is
# looking the extension up by hand afterwards.
readonly SCRATCH="${TMPDIR:-/tmp}/degreeify-safari-build"

xcodebuild \
  -project "$PROJECT" \
  -target "$APP_NAME" \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  SYMROOT="$SCRATCH/sym" \
  OBJROOT="$SCRATCH/obj" \
  build
