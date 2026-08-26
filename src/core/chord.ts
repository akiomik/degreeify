import { ACCIDENTAL_CHARS, type Note, parseNote, readNotePrefix } from './pitch';

/**
 * Chord symbols, parsed only as far as this project needs them: a root, an
 * opaque quality, and an optional bass note.
 *
 * The quality is never interpreted. Charts in the wild contain typos and
 * notation this parser has never seen, and turning an unrecognised symbol
 * into a wrong degree name is worse than leaving it alone, so anything that
 * is not clearly a root or a bass note is carried through verbatim.
 */

/** Whether the symbol was wrapped in the source text, as optional chords are. */
export type Wrapper = 'none' | 'parentheses';

export interface ChordSymbol {
  readonly root: Note;
  /** The part after the root, such as `m7`, `aug` or `M7(#11)`. Never interpreted. */
  readonly quality: string;
  /** The bass of a slash chord, from either `C/E` or `ConE`. */
  readonly bass: Note | null;
  readonly wrapper: Wrapper;
  /** The input, unchanged. */
  readonly raw: string;
}

/**
 * The spellings of the triangle that stands for a major seventh, and of the
 * dash. Named because a quality has to be allowed to contain them here and
 * understood in `key.ts`, and the two lists drifting apart would mean a chord
 * the parser accepts and the scorer cannot read.
 *
 * `DASH_MARKS` keeps the ASCII hyphen last so that it can be dropped straight
 * into a character class without opening a range.
 */
export const TRIANGLE_MARKS = '△▲∆Δ';
export const DASH_MARKS = '−－ー-';

/**
 * Characters a chord quality is written from.
 *
 * Passing an unknown quality through is deliberate, but "unknown" has to stop
 * somewhere: a quality is a run of letters, digits and a handful of symbols,
 * never a full stop, a space or a word in another script. Rejecting the rest
 * is what keeps a direction such as `D.C.` or a section label such as `Aメロ`
 * from being read as a chord on D or A. It also covers the multi-word
 * directions, `Da Capo` and `Dal Segno` among them, by way of the space.
 *
 * Where a symbol has look-alikes that get typed for it, the ones that turn up
 * in practice are here as well. A major seventh triangle is written `△` or
 * `∆` more often than it is with the Greek delta, and a Japanese keyboard
 * produces `＃`, `－` and `ー` as readily as the ASCII ones. The list will
 * never be exhaustive, and a spelling missing from it costs only a chord left
 * as it was.
 *
 * The accidentals are taken from `pitch.ts` rather than repeated here. One
 * allowed in a quality but unknown there would be read as the start of a
 * quality when it follows the root, relabelling the chord instead of leaving
 * it alone, so the two lists must not be able to drift apart. A new spelling
 * of an accidental belongs in {@link ACCIDENTAL_CHARS}, and reaches this set
 * from there.
 */
const OTHER_QUALITY_CHARS = `A-Za-z0-9()+,°øØ${TRIANGLE_MARKS}/${DASH_MARKS}`;

const QUALITY_CHARS = new RegExp(`^[${ACCIDENTAL_CHARS}${OTHER_QUALITY_CHARS}]*$`, 'u');

/**
 * Whole tokens that label a part of a chart rather than name a chord.
 *
 * Only the ones spelled with nothing but letters need to be listed. The rest
 * are already ruled out either by their first character not being a note
 * letter, as `N.C.`, `Intro` and `Segno` are, or by {@link QUALITY_CHARS}.
 *
 * A list is the only way to catch these. `Fine` is an F with a quality of
 * `ine` in exactly the way `Gbim` is a G flat with a quality of `im`, and
 * letting the second one through is the whole point of not interpreting the
 * quality. So the list cannot be complete, and a label nobody thought of that
 * starts with a note letter will still be read as a chord. That residual risk
 * is accepted; the alternative is a whitelist of qualities, which would drop
 * the typos this parser exists to tolerate.
 *
 * These are labels every chart shares. Anything particular to one site
 * belongs in that site's adapter.
 */
const PART_LABELS = new Set([
  'ad-lib',
  'adlib',
  'bass',
  'break',
  'bridge',
  'capo',
  'chorus',
  'coda',
  'drums',
  'encore',
  'end',
  'ending',
  'fade',
  'fill',
  'fine',
  'gtr',
  'guitar',
]);

/**
 * Parses a chord symbol, or returns null for anything that is not one.
 *
 * Returning null is the normal outcome for a lot of real input: chord charts
 * put bar lines, accents, rhythm notes, `N.C.` and section labels in the same
 * place as chords. Callers are expected to leave those untouched.
 *
 * ## Accidentals
 *
 * `#`, `♯`, `b` and `♭` are read as accidentals **only** directly after the
 * root letter and directly after the bass letter. Anywhere else they belong
 * to the quality and are passed through as written.
 *
 * This is what makes `Gbim` parse the way the site itself treats it, as G flat
 * plus a mistyped quality. The cost is that it cannot also support writing
 * flat tensions against a bare root: `Ab9` is A flat with a 9, never A with a
 * flat ninth. Charts that write `b9` rather than `-9` need this rule revisited.
 *
 * ## Parentheses
 *
 * Parentheses must balance, and a symbol is unwrapped only when the opening
 * one closes at the very end of the token. One rule then covers every case
 * seen in a chord slot: `(Em7)` unwraps and records its wrapper, a quality
 * such as `M7(#11)` keeps its own parentheses, a rhythm note such as `(3連)`
 * unwraps to something that is not a chord, and a stray `Em7)` is not a chord
 * at all.
 */
export function parseChord(raw: string): ChordSymbol | null {
  const unwrapped = unwrap(raw.trim());
  if (!unwrapped) return null;

  const { body, wrapper } = unwrapped;
  if (PART_LABELS.has(body.toLowerCase())) return null;

  const root = readNotePrefix(body);
  if (!root) return null;

  const { quality, bass } = splitBass(root.rest);
  if (!QUALITY_CHARS.test(quality)) return null;
  // A leading separator means the split landed on the wrong one, as in
  // `C/E/G`. Better to leave the whole token alone than to relabel part of it.
  if (quality.startsWith('/')) return null;

  return { root: root.note, quality, bass, wrapper, raw };
}

/**
 * Strips a pair of parentheses wrapping the whole token, and rejects tokens
 * whose parentheses do not balance.
 */
function unwrap(token: string): { body: string; wrapper: Wrapper } | null {
  let depth = 0;
  let closeOfFirst = -1;
  for (let index = 0; index < token.length; index++) {
    const char = token.charAt(index);
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth < 0) return null;
      if (depth === 0 && closeOfFirst < 0) closeOfFirst = index;
    }
  }
  if (depth !== 0) return null;

  const wrapped = token.startsWith('(') && closeOfFirst === token.length - 1;
  return wrapped
    ? { body: token.slice(1, -1).trim(), wrapper: 'parentheses' }
    : { body: token, wrapper: 'none' };
}

const BASS_SEPARATORS = ['/', 'on'] as const;

/**
 * Splits the text after the root into a quality and, if one is spelled out, a
 * bass note.
 *
 * Only the last occurrence of each separator is tried, and that is enough:
 * the text after an earlier occurrence always contains the separator itself,
 * and no note is spelled with a `/` or an `on` in it.
 */
function splitBass(rest: string): { quality: string; bass: Note | null } {
  for (const separator of BASS_SEPARATORS) {
    const at = rest.lastIndexOf(separator);
    if (at < 0) continue;
    const bass = parseNote(rest.slice(at + separator.length));
    if (bass) return { quality: rest.slice(0, at), bass };
  }
  return { quality: rest, bass: null };
}
