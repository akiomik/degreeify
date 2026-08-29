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
# Read out of the project rather than named here, and escaped, because the
# path comes from the file both scripts share and a copy of it here is the
# drift that file exists to stop. Both the quoted form and the bare one, for
# the same reason the check above accepts both.
built_pattern=$(printf '%s' "$BUILT" | sed 's/[][\.*^$/]/\\&/g')

named=()
while IFS= read -r name; do
  named+=("$name")
done < <(
  sed -n "s|.*/$built_pattern/\([^\";]*\)[\";].*|\1|p" "$PROJECT/project.pbxproj" | sort -u
)

# Nothing read is not an empty project; it is this no longer knowing how to
# read one, which is what the sibling says about the identifiers it cannot
# find. Left unsaid, the check passes everything and the failure it is here
# for comes back with nothing announcing it.
if [ ${#named[@]} -eq 0 ]; then
  echo "error: the project names no entry in $BUILT, which it must." >&2
  echo "The converter has changed how it writes them; this check needs" >&2
  echo "rewriting against what it does now." >&2
  exit 1
fi

gone=()
for name in "${named[@]}"; do
  [ -e "$BUILT/$name" ] || gone+=("$name")
done

if [ ${#gone[@]} -gt 0 ]; then
  echo "error: the Xcode project names entries the build no longer has:" >&2
  printf '  %s\n' "${gone[@]}" >&2
  echo "Xcode will stop on the first of them. Run 'npm run safari:xcode' to" >&2
  echo "generate the project again." >&2
  exit 1
fi

# Built somewhere neither the generator nor the system clears out. Building
# registers an app with LaunchServices wherever it lands, and that cannot be
# helped from here — what can is where it points. Inside `safari/` the next
# `--force` regeneration deletes it; under `TMPDIR` macOS empties it after a
# few days; either way the registration is left aimed at nothing, competing
# with the copy Xcode's own Run registers, in the one flow whose whole purpose
# is finding the extension by hand afterwards.
#
# Beside the build it wraps, then: ignored by git, untouched by `wxt build`,
# and gone only when somebody clears `.output` themselves.
#
# Absolute, because `xcodebuild` reads a relative one against the project's
# own directory rather than this shell's — which would put it back inside the
# tree the generator wipes, and quietly, since it builds either way.
readonly SCRATCH="$PWD/.output/safari-xcodebuild"

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

# And then taken away again, because what was wanted was the answer and not
# the app. Left there it is a second Degreeify registered under the same
# identifier as the one Xcode's Run installs, holding whatever it copied the
# last time this ran — so a reader who rebuilds and hits Run can be shown the
# older of the two by a system that has no reason to prefer either, and finds
# their change does nothing in Safari. Which is the failure this whole script
# is here to keep them out of.
#
# Unregistered before it is deleted, where the tool for it is where it has
# been; a path left in the database pointing at nothing is untidy rather than
# harmful, so not finding it is not worth failing over. The intermediates stay
# on, so the next run of this is not a build from nothing.
readonly LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -u "$SCRATCH/sym/Debug/$APP_NAME.app" || true
fi

rm -rf "$SCRATCH/sym"
