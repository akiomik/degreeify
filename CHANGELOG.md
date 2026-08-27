# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffolding: WXT with the Solid template, TypeScript, Biome, Vitest,
  and a GitHub Actions workflow.
- A Safari build target and a script that generates the wrapping Xcode project.
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
- Degree names on the page. The chart is read, each chord slot is rewritten
  in place, and everything that is not a chord — bar lines, accents, rhythm
  notes, `N.C.` — is left exactly as the site served it. A section whose key
  the chart states and this cannot read is left alone too, rather than named
  against the key of the section before it. Turning the extension off puts the
  page back character for character.
- A key set by hand, for a chart that says nothing this can use — one with no
  key line, or one whose single key line is written in a form this cannot
  read. A chart that states several keys is followed rather than overridden,
  so a section it modulates into is never named in a key meant for the page.
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
