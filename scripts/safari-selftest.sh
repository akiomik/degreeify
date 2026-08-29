#!/usr/bin/env bash
#
# Checks that the Safari scripts refuse what they say they refuse.
#
# These scripts have no other tests, and for most of their life they had none
# at all: each change was checked by hand against the case that prompted it,
# and what a change broke somewhere else was found by the next person to read
# it. That is a regression suite made of people. This is the same set of
# checks, written down once instead of retyped, so that a change has to get
# past every case before it is pushed rather than past the one in mind.
#
# macOS only, like everything else here, and it needs a build and a generated
# project to work on — `npm run build:safari && npm run safari:xcode` first.
# `xcodebuild` is stubbed throughout: what is under test is what the scripts
# decide, not what Xcode does with the answer.
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/safari-common.sh
. scripts/safari-common.sh

STUBS=$(mktemp -d)
readonly STUBS
# The build and the project put back however this ends. Every case here works
# by breaking one of them and mending it afterwards, so a run that stops in
# the middle leaves the next one testing a tree it did not set up — which is
# the failure this whole file exists to stop, arriving through the file
# itself.
finish() {
  rm -rf "$STUBS"
  npm run build:safari >/dev/null 2>&1 || true
  ./scripts/safari-xcode.sh >/dev/null 2>&1 || true
}

trap finish EXIT

passed=0
failed=0

# A stub standing in for `xcodebuild`, doing what the case needs and no more.
#
# `ok` assembles the app and succeeds, which is what the guards let through.
# `fails` assembles it and then fails, which is where cleanup has to run
# anyway. `slow` assembles it and waits, for the cases about interrupting.
stub() {
  # shellcheck disable=SC2016  # the stub's own script, expanded when it runs
  case $1 in
  ok) local body='mkdir -p "$sym/Debug/Degreeify.app/Contents"; echo "** BUILD SUCCEEDED **"' ;;
  fails) local body='mkdir -p "$sym/Debug/Degreeify.app/Contents"; echo "** BUILD FAILED **" >&2; exit 65' ;;
  slow) local body='mkdir -p "$sym/Debug/Degreeify.app/Contents"; sleep 20' ;;
  esac

  cat > "$STUBS/xcodebuild" <<SH
#!/bin/sh
for a in "\$@"; do case \$a in SYMROOT=*) sym=\${a#SYMROOT=};; esac; done
$body
SH
  chmod +x "$STUBS/xcodebuild"
}

# Runs the builder and says whether it ended as expected, and said so.
#
# The message matters as much as the status: several of these refusals differ
# only in what they tell the reader to do next, and one pointing at the wrong
# remedy has been a defect here more than once.
expect() {
  local label=$1 want=$2 says=${3-}
  local out status=0

  out=$(PATH="$STUBS:$PATH" ./scripts/safari-xcodebuild.sh 2>&1) || status=$?

  if [ "$status" != "$want" ]; then
    printf 'FAIL %s\n     exit %s, wanted %s\n' "$label" "$status" "$want" >&2
    failed=$((failed + 1))
    return
  fi

  if [ -n "$says" ] && ! printf '%s' "$out" | grep -qF "$says"; then
    printf 'FAIL %s\n     did not say: %s\n' "$label" "$says" >&2
    failed=$((failed + 1))
    return
  fi

  printf 'ok   %s\n' "$label"
  passed=$((passed + 1))
}

restore() {
  npm run build:safari >/dev/null 2>&1
  ./scripts/safari-xcode.sh >/dev/null 2>&1
}


if [ ! -d "$BUILT" ] || [ ! -f "$PROJECT/project.pbxproj" ]; then
  echo "error: needs a build and a project. Run 'npm run build:safari' and" >&2
  echo "'npm run safari:xcode' first." >&2
  exit 1
fi

stub ok

# ---------------------------------------------------------------- the guards

expect "a project that matches its build is built" 0

touch "$BUILT/selftest-new.js"
expect "a new top-level entry is refused" 1 "the Xcode project does not name"
rm -f "$BUILT/selftest-new.js"

# Not one of the icons: those are missing from the manifest's point of view
# too, and that check speaks first and says something else.
mv "$BUILT/assets" "$STUBS/assets-held"
expect "an entry the project still names is refused" 1 "the build no longer has"
mv "$STUBS/assets-held" "$BUILT/assets"

mkdir -p "$BUILT/.well-known"
expect "a dotted entry is refused, with no remedy" 1 "cannot carry"
rmdir "$BUILT/.well-known"

# The one dotted entry that must not refuse: macOS writes it into any folder
# somebody opens in Finder, and refusing it stops the build on every machine
# where that has happened.
touch "$BUILT/.DS_Store"
expect "a .DS_Store is tolerated" 0
rm -f "$BUILT/.DS_Store"

# Refused before the icons, because regenerating cannot help and the icons
# check would otherwise send the reader to do it anyway.
mkdir -p "$BUILT/.well-known"
cp "$BUILT/icon/16.png" "$STUBS/icon16-held"
cp "$BUILT/icon/48.png" "$BUILT/icon/16.png"
expect "the hopeless case is refused before the fixable one" 1 "cannot carry"
cp "$STUBS/icon16-held" "$BUILT/icon/16.png"
rmdir "$BUILT/.well-known"

# ----------------------------------------------------------------- the icons

# Every size, not the largest: the converter builds the app's icon set per
# size, so a change to a small one goes into the app just as much.
for size in 16 128; do
  cp "$BUILT/icon/$size.png" "$STUBS/held.png"
  cp "$BUILT/icon/48.png" "$BUILT/icon/$size.png"
  expect "a changed icon/$size.png is noticed" 1 "the icons have changed"
  cp "$STUBS/held.png" "$BUILT/icon/$size.png"
done

# An action icon sits beside the icon of the same size rather than in place of
# it, so the one it would have displaced is still watched.
node -e '
  const { readFileSync, writeFileSync } = require("node:fs");
  const path = process.argv[1];
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.action = { ...manifest.action, default_icon: { "16": "icon/32.png" } };
  writeFileSync(path, JSON.stringify(manifest));
' "$BUILT/manifest.json"
./scripts/safari-xcode.sh >/dev/null 2>&1
cp "$BUILT/icon/16.png" "$STUBS/held16.png"
cp "$BUILT/icon/48.png" "$BUILT/icon/16.png"
expect "an action icon does not hide the icon of its size" 1 "the icons have changed"
cp "$STUBS/held16.png" "$BUILT/icon/16.png"
restore

printf '' > "$ICONS_RECORD"
expect "a record of nothing is not a project made from no icons" 1 "missing or empty"
./scripts/safari-xcode.sh >/dev/null 2>&1

# ------------------------------------------------------- what it is given

mv "$BUILT/manifest.json" "$STUBS/manifest-held"
expect "a build with no manifest says which file" 1 "manifest.json not found"
mv "$STUBS/manifest-held" "$BUILT/manifest.json"

mv "$PROJECT/project.pbxproj" "$STUBS/pbx-held"
expect "a project with no project file says which file" 1 "project.pbxproj not found"
mv "$STUBS/pbx-held" "$PROJECT/project.pbxproj"

# ------------------------------------------------------- the build's own end

stub fails
expect "a failing build reports its own status" 65
if [ -d "$SCRATCH/sym/Debug/$APP_NAME.app" ]; then
  echo "FAIL a failing build leaves no app behind" >&2
  failed=$((failed + 1))
else
  echo "ok   a failing build leaves no app behind"
  passed=$((passed + 1))
fi

stub ok
PATH="$STUBS:$PATH" ./scripts/safari-xcodebuild.sh >/dev/null 2>&1
if [ -d "$SCRATCH/sym" ]; then
  echo "FAIL a build that worked leaves no app behind either" >&2
  failed=$((failed + 1))
else
  echo "ok   a build that worked leaves no app behind either"
  passed=$((passed + 1))
fi

# An interrupt has to be answered while the build is still running. Answered
# after it, a supervisor counting down to a kill has already stopped waiting,
# and the app is left registered.
stub slow
started=$(date +%s)
PATH="$STUBS:$PATH" ./scripts/safari-xcodebuild.sh >/dev/null 2>&1 &
waiting=$!
sleep 2
kill -TERM "$waiting" 2>/dev/null || true
interrupted_status=0
{ wait "$waiting" || interrupted_status=$?; } 2>/dev/null
took=$(($(date +%s) - started))

if [ "$interrupted_status" = 143 ] && [ "$took" -lt 10 ] &&
  [ ! -d "$SCRATCH/sym/Debug/$APP_NAME.app" ]; then
  echo "ok   an interrupt is answered while the build is still running"
  passed=$((passed + 1))
else
  printf 'FAIL an interrupt is answered while the build is still running\n' >&2
  printf '     exit %s after %ss, app left: %s\n' \
    "$interrupted_status" "$took" \
    "$([ -d "$SCRATCH/sym/Debug/$APP_NAME.app" ] && echo yes || echo no)" >&2
  failed=$((failed + 1))
fi

# --------------------------------------------------------- the generator

# A generation that cannot finish must leave no record. The record says what
# the project was made from, and one sitting beside a project the generator
# refused has the builder pass it through to a failure several steps away.
#
# Both doors into it. One conversion that works and a recording that does not
# — an icon the manifest names, taken away — and one that works and is then
# refused by a check, which is the door the record has to be written after.
mv "$BUILT/icon/48.png" "$STUBS/icon48-held"
./scripts/safari-xcode.sh >/dev/null 2>&1 || true
mv "$STUBS/icon48-held" "$BUILT/icon/48.png"

if [ -f "$ICONS_RECORD" ]; then
  echo "FAIL a generation that could not record leaves no record" >&2
  failed=$((failed + 1))
else
  echo "ok   a generation that could not record leaves no record"
  passed=$((passed + 1))
fi

env BUNDLE_ID="$BUNDLE_PREFIX.does-not-nest" ./scripts/safari-xcode.sh >/dev/null 2>&1 || true

if [ -f "$ICONS_RECORD" ]; then
  echo "FAIL a generation its checks refused leaves no record" >&2
  failed=$((failed + 1))
else
  echo "ok   a generation its checks refused leaves no record"
  passed=$((passed + 1))
fi
restore

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
