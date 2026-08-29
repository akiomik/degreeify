# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffolding: WXT with the Solid template, TypeScript, Biome, Vitest,
  and a GitHub Actions workflow.
- A Safari build target, a script that generates the wrapping Xcode project,
  and a second that builds it without opening Xcode. The generated project
  references the built extension rather than copying it, so most code changes
  need a rebuild and another Run in Xcode and no regenerated project. Changing
  an icon needs one, as does adding, removing or renaming a top-level file in
  the build; the build script refuses to run on any of those rather than let
  the app be assembled from a project that no longer describes it, and takes
  its own build away afterwards rather than leave a second copy of the app
  registered, and refuses where the build holds a dotted entry other than
  `.DS_Store`, which no project carries and no regeneration can fix.
  It also refuses a project generated under names these scripts no longer use,
  which otherwise built and installed under the old identifier and made a
  rename silently a no-op. Both are Node programs, and what they refuse is
  covered by the test suite: the checks are functions of what was read, so most
  of the cases are about projects that were never on a disk, and the rest run
  each script against a tree made for the case with `xcrun` and `xcodebuild`
  stubbed. The
  wrapper's bundle identifier is `com.github.akiomik.Degreeify`,
  where it was `com.github.akiomik.degreeify`: the converter builds the app's
  identifier from the prefix plus the app name, so the lower-case one produced
  an app and an extension that did not nest, and a project Xcode refused to
  build.
- A chord symbol parser that reads a root, an opaque quality and an optional
  bass note, and reports anything else — bar lines, accents, rhythm notes,
  `N.C.`, chart directions, section labels — as not a chord so it can be left
  alone.
- Degree names, so a chord reads against the key it is in rather than in
  absolute pitch. Enharmonic spellings are settled from a list of the
  spellings in use, which keeps the same chord reading the same way whichever
  transposition of a chart it is found on. The chart's own spelling can be
  kept instead where it is one of the conventional pair.
- Two notations for a degree name: `roman-ascii` by default, since a chart is
  laid out in a monospaced font, and `roman-unicode`, which spells a numeral
  as a single character for when a name has to fit a narrower column. Whether
  it is in fact narrower is still to be measured on a real page; see
  `src/core/notation.ts` for the widths it actually renders at.
- Key inference, for charts that state no key. Every key is scored on how many
  of the chart's chords it accounts for, on whether the chart opens and closes
  on its tonic, and on whether it holds a chord only one of two relative keys
  has — the last two being all that separates relatives, which share every
  chord of their scale. Where nothing chooses between the leading candidates
  the guess is declined, leaving the chart in chord names rather than
  relabelling it against the wrong tonic.
- A popup, and the settings behind it. The names can be turned off, the
  numerals written as `I` or as `Ⅰ`, and a chord's spelling followed or
  normalised. The popup also says what key the chart was read in and where
  that reading came from — the page, a guess, or a person — because a chart
  with no names on it and an extension that is switched off look the same
  otherwise.
- A key set by hand, per chart, for a chart that one key can answer for: one
  with no key line, or with a single one, read or unread. It is kept as the
  key of the untransposed chart and moved to wherever the reader has
  transposed it, so that transposing a chart does not lose the key set for it.
  A chart that states several keys is followed rather than overridden — a
  section it modulates into is never named in a key meant for the page — and
  the popup says so instead of offering a control that would not work.
- What the page was read as is written down whether or not the names are being
  shown. Turning the names off leaves the page as the site served it; it does
  not stop the extension knowing what key the chart is in, so a reader can see
  that before deciding to turn them on.
- Degree names on the page. The chart is read, each chord slot is rewritten
  in place, and everything that is not a chord — bar lines, accents, rhythm
  notes, `N.C.` — is left exactly as the site served it. A section whose key
  the chart states and this cannot read is left alone too, rather than named
  against the key of the section before it. Turning the extension off puts the
  page back character for character.
- A width lock, so that naming a chart does not move it. A slot is measured
  before it is rewritten and fixed at that width, so a name longer than the
  chord it stands for overhangs rather than pushing the lyric under it out of
  line. A slot that measures nothing — one that is not being rendered — is
  left to lay itself out instead.
- A reader for ChordWiki charts, and the shape every later site fits: the
  chords in document order together with the keys they are read in, so that
  which chords fall under which key needs no reconstructing. It reads the key
  the page is being played in rather than the one the chart was written in,
  which on a transposed chart are different and stated in the same line, and
  it names a chart by what identifies it to the site rather than by the
  address it was reached at, so that transposing one — or reaching it another
  way — does not lose the settings kept against it.
