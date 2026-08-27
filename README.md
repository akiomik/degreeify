# Degreeify

A browser extension that rewrites chord names on chord-chart sites into degree
names, so a chart reads as `I - VIm - IV - V` instead of `C - Am - F - G`.

> **Status: proof of concept.** Only [ChordWiki](https://ja.chordwiki.org) is
> supported, and the extension is not published to any store. Install it
> unpacked (see below).

## Features

- Replaces the chord symbols on a ChordWiki chart with degree names.
- Reads the key from the chart itself, including charts that change key
  part-way through, and follows ChordWiki's own transposition.
- Turns off from the popup, restoring the original chord names exactly.
- Lets you set the key by hand, whether or not the page declares one — for a
  chart that changes key, the chart is followed instead.

## Using it

Open a ChordWiki chart. The chords are replaced with degree names; click the
extension icon for the rest.

The popup shows what key the chart was read in and where that came from — the
page's own declaration, a guess from the chords, or a key you set — along with
how many chords were named and how many key declarations could not be read. It
also carries four controls: whether to show the names at all, the key for this
chart, which numerals to use, and whether to follow the chart's spelling of a
chord or normalise it.

The key you set is kept for that chart rather than for the address it was at,
so transposing the chart with ChordWiki's own control keeps it. A chart that
declares more than one key is followed rather than overridden.

## Known limitations

- **Resizing across the mobile breakpoint.** ChordWiki changes font size at
  640px. Chord slots are measured once, so resizing the window across that
  point leaves the locked widths matching the font size they were measured at.
  Reloading the page re-measures.
- **A long degree name overhangs its slot.** Locking the width is what keeps
  the lyrics and bar lines aligned, so a name wider than the chord it replaces
  runs into the space beside it rather than widening the column.
- **A chart that states no key and points at no key is left alone.** Guessing
  wrong is worse than not naming, so the guess is declined where the chords do
  not settle it; set the key by hand from the popup. The same applies to a
  chart whose one key line is written in a form this cannot read.
- **A chart that changes key cannot be overridden section by section.** A key
  set by hand covers a chart that says nothing this can use. Where a chart
  states several keys and one of them cannot be read, that section is left as
  the chart wrote it rather than named in the key given for the page.

## Requirements

- Node.js 26 (see `.node-version`)
- npm
- For the Safari build only: macOS with Xcode installed

## Development

```sh
npm install
npm run dev          # Chrome, with hot reload
npm run dev:firefox  # Firefox
```

`npm run dev` launches a browser with the extension already loaded. To load a
build by hand instead:

```sh
npm run build
```

then open `chrome://extensions`, enable **Developer mode**, choose **Load
unpacked**, and select `.output/chrome-mv3`.

### Checks

```sh
npm run lint       # Biome (lint + format check)
npm run typecheck  # tsc --noEmit
npm test           # Vitest
```

`npm run lint:fix` and `npm run format` apply fixes.

## Safari

Safari is supported from the same codebase, built as MV3 and wrapped in an
Xcode project. The extension is never published to the App Store; this is for
local verification only.

```sh
npm run build:safari
npm run safari:xcode   # generates ./safari (git-ignored)
```

Then, in Safari:

1. **Settings → Advanced →** enable *Show features for web developers*.
2. **Develop → Developer Settings →** enable *Allow unsigned extensions*.
   This resets every time Safari restarts.
3. Open the generated Xcode project and **Run**.
4. **Settings → Extensions →** enable Degreeify.
5. Grant Degreeify permission for `ja.chordwiki.org` (choose *Always Allow*).

The Xcode project references the files in `.output/safari-mv3` rather than
copying them, so `npm run build:safari` alone is enough to pick up code
changes — no need to regenerate the project.

## Layout

```
src/core/         music theory. No DOM, no browser APIs
src/sites/        per-site adapters that read a chart out of the page
src/content/      applying and restoring degree names in the page
src/settings/     settings schema and storage wrapper
src/entrypoints/  WXT entrypoints (the only place that depends on WXT)
tests/            unit tests and hand-written DOM fixtures
```

Dependencies point one way: `entrypoints → content → sites → core`, with
`settings` reachable from the outer layers. `core` depends on nothing.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
