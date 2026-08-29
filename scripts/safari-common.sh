# shellcheck shell=bash
#
# What both Safari scripts need. Sourced, never run — no shebang, because
# running it would do nothing.
#
# Here rather than in each of them because they have to agree: a name or a
# path that means one thing in the generator and another in the builder is a
# builder checking a project nobody generated.
#
# shellcheck disable=SC2034  # read by the scripts that source this

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

# What the icons were when the project was generated, kept beside it.
readonly ICONS_RECORD="safari/$APP_NAME/.icons"

# One line standing for every icon the manifest declares.
#
# Recorded at generation and compared at build, rather than working out which
# icons the converter used and comparing those. Which it takes and what it
# makes of them is its business, and describing that business has been got
# wrong here three times running. What is actually being asked is whether the
# icons have changed since the project was made from them, and that can be
# asked without knowing what was done with them.
icons_digest() {
  # shellcheck disable=SC2016  # the script is node's to expand, not the shell's
  node -e '
    const { readFileSync } = require("node:fs");
    const { createHash } = require("node:crypto");

    const built = process.argv[1];
    try {
      const { icons = {} } = JSON.parse(readFileSync(`${built}/manifest.json`, "utf8"));
      const digest = createHash("sha256");

      for (const size of Object.keys(icons).sort()) {
        digest.update(size);
        digest.update(readFileSync(`${built}/${icons[size]}`));
      }

      process.stdout.write(digest.digest("hex"));
    } catch (reason) {
      process.stderr.write(`error: could not read the icons of ${built}: ${reason.message}\n`);
      process.exit(3);
    }
  ' "$BUILT"
}
