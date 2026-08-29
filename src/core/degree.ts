import type { ChordSymbol, Wrapper } from './chord';
import type { Key } from './key';
import { letterIndex, type Note, pitchClass } from './pitch';

/**
 * Degree names: what a chord is called relative to the key rather than in
 * absolute pitch, so `C - Am - F - G` in C reads as `I - VIm - IV - V`.
 */

export type Numeral = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A degree is only ever raised or lowered by a semitone, never more. */
export type Alteration = -1 | 0 | 1;

export interface Degree {
  readonly numeral: Numeral;
  readonly alteration: Alteration;
}

export interface DegreeChord {
  readonly root: Degree;
  /** Carried over from the chord symbol unchanged. */
  readonly quality: string;
  readonly bass: Degree | null;
  readonly wrapper: Wrapper;
}

/**
 * How to spell a degree whose pitch has two conventional names.
 *
 * `canonical` always picks the same one, which makes a degree name depend on
 * nothing but the pitch. `source` keeps the spelling the chart used where
 * that spelling is one of the conventional pair, which preserves the sense of
 * a `#IIdim` written deliberately as a passing chord.
 *
 * `canonical` is the default. A transposing chart is not spelling
 * enharmonics by their function — the same chord comes back as `bVI` or `#V`
 * depending only on which transposition of the page is being read — so
 * deferring to the source there means deferring to an arbitrary choice. The
 * price is losing the occasional deliberate spelling on an untransposed page.
 */
export const SPELLING_POLICIES = ['canonical', 'source'] as const;

export type SpellingPolicy = (typeof SPELLING_POLICIES)[number];

type Semitones = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
type ScaleStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const degree = (numeral: Numeral, alteration: Alteration): Degree => ({ numeral, alteration });

/**
 * Semitones above the tonic mapped to the spellings that degree is
 * conventionally given, the default first.
 *
 * Deriving the numeral from the distance between note letters instead — `Gb`
 * against C is four letters up and a semitone flat, so `bV` — is faithful to
 * the chart but only as sound as the chart's own spelling. Run over real
 * pages it produces `bI`, `bbII` and other things nobody writes, because the
 * spelling it is being faithful to came out of a transposition routine. A
 * list of what is actually written keeps those off the page: a spelling that
 * is not on it falls back to the default for that pitch.
 */
const ALLOWED_SPELLINGS = [
  [degree(1, 0)],
  [degree(2, -1), degree(1, 1)],
  [degree(2, 0)],
  [degree(3, -1), degree(2, 1)],
  [degree(3, 0)],
  [degree(4, 0)],
  [degree(4, 1), degree(5, -1)],
  [degree(5, 0)],
  [degree(6, -1), degree(5, 1)],
  [degree(6, 0)],
  [degree(7, -1), degree(6, 1)],
  [degree(7, 0)],
] as const;

const MAJOR_SCALE_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/**
 * Names a note as a degree of `key`.
 *
 * Only the tonic of the key is used. A degree is measured from the tonic's
 * major scale whatever the mode, which is what makes a minor key need no
 * special handling: in A minor, `Am` is `Im`, `C` is `bIII` and `E7` is `V7`.
 */
export function toDegree(note: Note, key: Key, policy: SpellingPolicy = 'canonical'): Degree {
  // Both stay in range by construction; the modulo is what guarantees it.
  const semitones = ((pitchClass(note) - pitchClass(key.tonic) + 12) % 12) as Semitones;
  const allowed = ALLOWED_SPELLINGS[semitones];

  if (policy === 'canonical') return allowed[0];

  const spelled = asWritten(note, key, semitones);
  return spelled && allowed.some((option) => isSame(option, spelled)) ? spelled : allowed[0];
}

export function toDegreeChord(
  chord: ChordSymbol,
  key: Key,
  policy: SpellingPolicy = 'canonical',
): DegreeChord {
  return {
    root: toDegree(chord.root, key, policy),
    quality: chord.quality,
    bass: chord.bass ? toDegree(chord.bass, key, policy) : null,
    wrapper: chord.wrapper,
  };
}

/**
 * The degree the chart's own spelling of a note describes, or null when that
 * is further than a semitone from the scale and so not a degree this can name.
 */
function asWritten(note: Note, key: Key, semitones: Semitones): Degree | null {
  const step = ((letterIndex(note.letter) - letterIndex(key.tonic.letter) + 7) % 7) as ScaleStep;

  // Shifting by 6 before the modulo puts the result in -6..5 rather than
  // 0..11, so a note a semitone below the scale reads as -1 and not as +11.
  const alteration = ((semitones - MAJOR_SCALE_SEMITONES[step] + 18) % 12) - 6;
  if (alteration < -1 || alteration > 1) return null;

  return degree((step + 1) as Numeral, alteration as Alteration);
}

function isSame(one: Degree, other: Degree): boolean {
  return one.numeral === other.numeral && one.alteration === other.alteration;
}
