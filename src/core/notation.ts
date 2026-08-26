import type { Degree, DegreeChord, Numeral } from './degree';

/**
 * Turning a degree into the text that goes on the page.
 *
 * `roman-ascii` is the default because a chart is laid out in a monospaced
 * font and ASCII is the only spelling certain to be measured as one column
 * per character. `roman-unicode` is narrower — `Ⅶ` occupies one character
 * where `VII` occupies three — which matters when a degree name has to fit
 * the width of the chord name it replaces.
 */
export type Notation = 'roman-ascii' | 'roman-unicode';

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
 * a second rather than a first. It is wrong in the chart to begin with, and
 * there is no way to tell such a quality from a real one, so it is left to
 * read oddly rather than guessed at.
 */
export function formatDegreeChord(chord: DegreeChord, notation: Notation = 'roman-ascii'): string {
  const root = formatDegree(chord.root, notation);
  const bass = chord.bass ? `/${formatDegree(chord.bass, notation)}` : '';
  const text = root + chord.quality + bass;
  return chord.wrapper === 'parentheses' ? `(${text})` : text;
}
