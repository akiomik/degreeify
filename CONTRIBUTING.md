# Contributing

## English only

Everything visible on GitHub is written in English: code, identifiers,
comments, documentation, commit messages, PR titles and bodies, review
comments, and issues.

There is one deliberate exception, described under
[Test fixtures](#test-fixtures).

## Commits

This repository follows [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
  `ci`, `chore`, `revert`.
- Scopes in use: `core`, `chordwiki`, `content`, `popup`, `safari`, `ci`.
- Breaking changes take a `!` after the type/scope and a `BREAKING CHANGE:`
  footer.
- PR titles follow the same format and are checked in CI.

Example: `feat(core): add degree calculation with spelling whitelist`

## Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/): an
`Unreleased` section with `Added` / `Changed` / `Deprecated` / `Removed` /
`Fixed` / `Security` subsections.

The changelog is written by hand and is **not** generated from commit
messages. The two serve different readers: commits are a machine-readable
history, the changelog is for people. Any PR with a user-visible change must
add an entry under `Unreleased`.

## Test fixtures

**Never commit a saved copy of a page from a supported site.** Chord charts
contain song lyrics, which are copyrighted. Fixtures under `tests/fixtures/`
are written by hand and reproduce only the *structure* of a page — tag names,
class names, nesting, form shape — which is a technical interface rather than
an expressive work.

When writing a fixture:

- No lyrics. Fill `span.word` with beat/bar markers or `xxxx`.
- No real song's chord progression. Invent a progression that exercises the
  parser and adapter edge cases you need.
- Use placeholder metadata (`Test Song`, `Test Artist`).
- Do not copy the site's CSS. happy-dom does not lay pages out, so tests do
  not need it.
- Open the file with an English comment stating that it is a hand-written
  reproduction and not a copy of a real page.

The HTML fixtures are excluded from Biome. They reproduce another site's
markup, faults and all — inline handlers on elements that take no keyboard,
among others — and being told about those is being told about the site rather
than about this project. Formatting them would obscure what they reproduce.
`transposition-pairs.ts` is ours and is linted like anything else.

### Non-English test data

As an explicit exception to the English-only rule, test data may hold real
tokens from a supported site verbatim — for example `(3連)`, `(2拍3連)`, `＞`.
The parser is required to pass these through untouched, and verifying that
needs the real strings.

The exception covers **data only**. Comments, identifiers, and test names stay
in English, and non-English strings appear only as observed input or expected
output.

## Popup styling

The popup deliberately uses no component library and no CSS framework:

- Native `<select>` and `<input type="checkbox">` come with correct keyboard
  and screen-reader behaviour, and look like the host OS for free.
- `color-scheme: light dark` makes native controls follow the OS theme.
- Styles are plain CSS Modules plus custom properties, so Biome stays the only
  formatter and linter in the project.

Content scripts must never inject a global CSS reset — it would break the
layout of the page being annotated.
