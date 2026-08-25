import { type Note, parseNote, readNotePrefix } from './pitch';

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
 * Parses a chord symbol, or returns null for anything that is not one.
 *
 * Returning null is the normal outcome for a lot of real input: chord charts
 * put bar lines, accents, rhythm notes and `N.C.` in the same place as chords.
 * Callers are expected to leave those untouched.
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
 * A symbol wrapped in parentheses, as optional chords are written, is
 * unwrapped and recorded in {@link ChordSymbol.wrapper} so callers can put the
 * parentheses back. Only a token that both starts and ends with a parenthesis
 * is unwrapped, which leaves a quality such as `M7(#11)` intact and lets a
 * rhythm note such as `(3連)` fail to parse and be passed through.
 */
export function parseChord(raw: string): ChordSymbol | null {
  const trimmed = raw.trim();
  const wrapped = trimmed.length > 2 && trimmed.startsWith('(') && trimmed.endsWith(')');
  const body = wrapped ? trimmed.slice(1, -1) : trimmed;

  const root = readNotePrefix(body);
  if (!root) return null;

  const { quality, bass } = splitBass(root.rest);
  return {
    root: root.note,
    quality,
    bass,
    wrapper: wrapped ? 'parentheses' : 'none',
    raw,
  };
}

const BASS_SEPARATORS = ['/', 'on'] as const;

/** Splits the text after the root into a quality and, if one is spelled out, a bass note. */
function splitBass(rest: string): { quality: string; bass: Note | null } {
  for (const separator of BASS_SEPARATORS) {
    const at = rest.lastIndexOf(separator);
    if (at < 0) continue;
    const bass = parseNote(rest.slice(at + separator.length));
    if (bass) return { quality: rest.slice(0, at), bass };
  }
  return { quality: rest, bass: null };
}
