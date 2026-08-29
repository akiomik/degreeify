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

# What the project names, read once and asked both ways. Two readings would
# be two ideas of what "named" means, and the checks below disagreeing about
# that is the drift the file they share their paths through exists to stop.
#
# Escaped, because the path comes from that shared file and this has to hold
# for whatever it says — including the delimiter below, which a path is as
# free to contain as anything else and which would end the expression early
# rather than fail in a way that says so.
#
# Both the quoted form and the bare one, since the project file quotes only
# what needs it.
built_pattern=$(printf '%s' "$BUILT" | sed 's/[][\.*^$|]/\\&/g')

named=()
while IFS= read -r name; do
  named+=("$name")
done < <(
  # No separator in what is captured: these are the names of things at the top
  # of the build, and one with a `/` in it is a reference to something inside
  # a directory rather than the directory. Recorded whole it would be an entry
  # no name can equal, and the directory holding it would be reported unnamed
  # — a project called stale for having said more than expected.
  sed -n "s|.*/$built_pattern/\([^\";/]*\)[\";].*|\1|p" "$PROJECT/project.pbxproj" | sort -u
)

# Nothing read is not an empty project; it is this no longer knowing how to
# read one, which is what the sibling says about the identifiers it cannot
# find. Asked before either check below, because both of them read an
# unreadable project as every entry being wrong — and then send the reader to
# regenerate a project that will be just as unreadable next time.
if [ ${#named[@]} -eq 0 ]; then
  echo "error: the project names no entry in $BUILT, which it must." >&2
  echo "The converter has changed how it writes them; this check needs" >&2
  echo "rewriting against what it does now." >&2
  exit 1
fi

# What the build has and the project does not name, which would be left out of
# the app with nothing said.
missing=()
for entry in "$BUILT"/*; do
  name=$(basename "$entry")
  found=

  for candidate in "${named[@]}"; do
    [ "$candidate" = "$name" ] && found=yes && break
  done

  [ -n "$found" ] || missing+=("$name")
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

# What was wanted from this is the answer, not the app: left where it is
# built, it is a second Degreeify registered under the same identifier as the
# one Xcode's Run installs, holding whatever it copied the last time this ran.
# A reader who rebuilds and hits Run can then be shown the older of the two by
# a system with no reason to prefer either, and finds their change does
# nothing in Safari — which is the failure this whole script is here to keep
# them out of.
#
# Unregistered before it is deleted, where the tool for it is where it has
# been; a path left in the database pointing at nothing is untidy rather than
# harmful, so not finding it is not worth failing over. The intermediates stay
# on, so the next run of this is not a build from nothing.
readonly LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

# Taken away however this ends, and not only where it ends well. A build that
# stops after the app wrapper is assembled — a Swift error in the app target,
# an interrupt during the several minutes it takes — leaves the copy behind
# exactly when it does the most harm: the reader is now debugging, and the
# stale app is what Safari may show them while they do it. Removed only on the
# next success, it would sit there for as long as the build kept failing.
cleanup() {
  local app="$SCRATCH/sym/Debug/$APP_NAME.app"

  # Asked for only where there is something to unregister, and quietly. A
  # build that stopped before assembling the app leaves nothing here, and the
  # tool says so at length on stderr — directly under the real error, reading
  # as a second failure that has nothing to do with anything. Which is also
  # what stops this speaking twice when an interrupt runs it and the exit runs
  # it again: by then the app is gone and there is nothing to say.
  if [ -d "$app" ] && [ -x "$LSREGISTER" ]; then
    "$LSREGISTER" -u "$app" >/dev/null 2>&1 || true
  fi

  rm -rf "$SCRATCH/sym"
}

# Re-raised rather than swallowed. A handler that returns without exiting
# leaves the script to run on past the command the signal interrupted — and
# `xcodebuild` is the last thing here, so it would fall off the end and report
# success for a build that never finished, to a caller reading the exit status
# to decide whether the project still compiles.
#
# Where the signal reached this script alone rather than the group — `kill` on
# the pid, a supervisor, a timeout — `xcodebuild` outlives it and may write
# back what was just removed. The next run of this removes it again; nothing
# here can do better without killing a process it was not asked to manage.
#
# One case is out of reach entirely, and not by this script's doing: a signal
# ignored when the shell starts cannot be trapped, and a script started in the
# background has its interrupt ignored — so `kill -INT` on one of those runs
# none of this and exits successfully. Nothing written here changes that,
# which is why nothing here tries to.
interrupted() {
  cleanup
  trap - EXIT "$1"
  kill -s "$1" $$
}

trap cleanup EXIT
trap 'interrupted INT' INT
trap 'interrupted TERM' TERM

# The architecture this is running on, named. Left to itself `xcodebuild`
# finds no active one to build for, says so once per target, and builds every
# architecture it could — which answers a question nobody asked, since what is
# wanted is whether the project compiles on this machine, and this machine is
# what Xcode's Run will build for.
#
# Measured rather than assumed: a second off a ten-second build here, and two
# warnings that were the only thing this ever printed on a good run. Naming a
# `-destination` instead does neither.
xcodebuild \
  -project "$PROJECT" \
  -target "$APP_NAME" \
  -configuration Debug \
  ARCHS="$(uname -m)" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  SYMROOT="$SCRATCH/sym" \
  OBJROOT="$SCRATCH/obj" \
  build


