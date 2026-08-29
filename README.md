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
  chart that changes key, or one whose page does not say how far it has been
  transposed, the chart is followed instead.

## Using it

Open a ChordWiki chart. The chords are replaced with degree names; click the
extension icon for the rest.

The popup shows what key the chart was read in and where that came from — the
page's own declaration, a guess from the chords, or a key you set — along with
how many chords were named and how many key declarations could not be read. It
also carries the controls: whether to show the names at all, the key and mode
for this chart, which numerals to use, and whether to follow the chart's
spelling of a chord or normalise it.

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
- **A chart that changes key cannot be given a key by hand.** A key you set
  covers a chart that states at most one of its own — read or unread, it is
  yours that is used. A chart that states several is followed instead, and a
  section whose declaration cannot be read is left as the chart wrote it.
- **A key cannot be set on a page that does not say how far it has been
  transposed.** What is kept is the key of the untransposed chart, so setting
  one needs to know how far the chart has moved. ChordWiki says so on every
  chart today; if it stops, the popup says why instead of offering a control
  that would keep nothing.
- **Settings written by a newer version are not changed, and no chart is
  rewritten while they are in place.** Going back to an older build leaves
  them readable only by the newer one; the popup says so rather than offering
  controls that would write over them, and pages are left as the site served
  them rather than named against defaults you did not choose. The same applies
  where the settings cannot be read at all.

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
npm run build:safari    # build the extension
npm run safari:xcode    # generate ./safari (git-ignored)
npm run safari:build    # check the project against the build, and compile it
```

That leaves an Xcode project at `safari/Degreeify/Degreeify.xcodeproj`. Then,
in Safari:

1. **Settings → Advanced →** enable *Show features for web developers*.
2. **Develop → Developer Settings →** enable *Allow unsigned extensions*.
   This resets every time Safari restarts.
3. Open the project and **Run**. The app it builds is a wrapper whose only job
   is to tell Safari the extension exists; it has no interface worth looking
   at.
4. **Settings → Extensions →** enable Degreeify.
5. Grant Degreeify permission for `ja.chordwiki.org` (choose *Always Allow*).

After a code change, `npm run build:safari && npm run safari:build`, then
**Run** again. The third command is what notices a project that has gone stale
against the build; Xcode's Run makes no such check and will assemble an app
that is quietly missing whatever the project does not name.

The project references the files in `.output/safari-mv3` rather than copying
them, so a code change needs no regenerated project. Changing a permission or
a content script needs none either: neither reaches the wrapper, which takes
its name from the conversion and its version from nothing.

Regenerate for two things. The first is the **icons**, which are the one thing
the wrapper takes from the extension: the converter copies them in when it
generates the project. A change to any of them therefore reaches Safari's
extension list on a rebuild and leaves the app showing the old ones until the
project is generated again.

The second is a **top-level** file or directory in the build, which a new
entrypoint would add. The project names those one by one and directories among
them by reference: a file added inside `chunks/` or `content-scripts/` arrives
on its own, while a new top-level one is in the build and missing from the app
Xcode assembles, with nothing said. `npm run safari:build` refuses to build
when it finds one, since otherwise this is discovered by wondering why a
feature does nothing in Safari alone. It refuses on icons that have changed
since the project was generated too, which it knows by comparing them against
what they were at the time.

## Layout

```
src/core/         music theory. No DOM, no browser APIs
src/sites/        per-site adapters that read a chart out of the page
src/content/      applying and restoring degree names in the page
src/settings/     settings schema and storage wrapper
src/entrypoints/  WXT entrypoints (the only place that depends on WXT)
tests/            unit tests and hand-written DOM fixtures
scripts/          generating and building the Safari wrapper
```

Dependencies point one way: `entrypoints → content → sites → core`, with
`settings` reachable from the outer layers. `core` depends on nothing.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
