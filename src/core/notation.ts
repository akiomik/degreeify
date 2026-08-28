import type { Degree, DegreeChord, Numeral } from './degree';

/**
 * Turning a degree into the text that goes on the page.
 *
 * `roman-ascii` is the default because a chart is laid out in a monospaced
 * font and ASCII is the only spelling certain to be measured one column per
 * character.
 *
 * `roman-unicode` exists to be measured against it, for when a degree name
 * has to fit the width of the chord name it replaces. Whether it helps is an
 * open question rather than a given, and counting code points is the wrong
 * way to answer it. Every character it uses — `Ⅰ` to `Ⅶ`, `♭` and `♯` — has
 * an East Asian width of Ambiguous, so a Japanese page renders all of them
 * full width, two columns each:
 *
 * | ascii | columns | unicode | columns |
 * | --- | --- | --- | --- |
 * | `III`, `VII` | 3 | `Ⅲ`, `Ⅶ` | 2 |
 * | `II`, `IV`, `VI` | 2 | `Ⅱ`, `Ⅳ`, `Ⅵ` | 2 |
 * | `I`, `V`, `b`, `#` | 1 | `Ⅰ`, `Ⅴ`, `♭`, `♯` | 2 |
 *
 * Two of the seven numerals come out shorter, two come out longer, and an
 * accidental always costs a column: `♯Ⅳ` takes four where `#IV` takes three.
 * On top of that, monospaced fonts often have no glyph for U+2160 to U+2166,
 * which falls back to a proportional face and loses the alignment the whole
 * exercise is meant to protect.
 *
 * So this has to be measured on a real page before anything is allowed to
 * depend on it. If it turns out to be the wrong trade, the thing to try next
 * is ASCII numerals with the symbol accidentals.
 */
export const NOTATIONS = ['roman-ascii', 'roman-unicode'] as const;

export type Notation = (typeof NOTATIONS)[number];

const NUMERALS: Record<Notation, Record<Numeral, string>> = {
  'roman-ascii': { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII' },
  'roman-unicode': { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ', 4: 'Ⅳ', 5: 'Ⅴ', 6: 'Ⅵ', 7: 'Ⅶ' },
};

const FLATS: Record<Notation, string> = { 'roman-ascii': 'b', 'roman-unicode': '♭' };
const SHARPS: Record<Notation, string> = { 'roman-ascii': '#', 'roman-unicode': '♯' };

export function formatDegree(degree: Degree, notation: Notation = 'roman-ascii'): string {
  const { numeral, alteration } = degree;
  const mark = alteration < 0 ? FLATS[notation] : alteration > 0 ? SHARPS[notation] : '';
  return mark + NUMERALS[notation][numeral];
}

/**
 * Formats a chord, putting back the parentheses of an optional chord and
 * writing a bass with a slash however the chart spelled it.
 *
 * The quality goes through as it came in, which is worth knowing about: a
 * quality that starts with a roman numeral letter reads as part of the
 * numeral. A mistyped `Gbim` in F sharp comes out as `Iim`, which looks like
 * a second rather than a first, and a quality starting with a `v` would read
 * as a different numeral outright. Such a quality is wrong in the chart to
 * begin with, and nothing tells it from a real one, so it is left to read
 * oddly rather than guessed at.
 */
export function formatDegreeChord(chord: DegreeChord, notation: Notation = 'roman-ascii'): string {
  const root = formatDegree(chord.root, notation);
  const bass = chord.bass ? `/${formatDegree(chord.bass, notation)}` : '';
  const text = root + chord.quality + bass;
  return chord.wrapper === 'parentheses' ? `(${text})` : text;
}
