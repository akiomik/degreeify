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
