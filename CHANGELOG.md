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
