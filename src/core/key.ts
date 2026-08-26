import type { ChordSymbol } from './chord';
import { formatNote, type Note, parseNote, pitchClass, readNotePrefix } from './pitch';

export type Mode = 'major' | 'minor';

/**
 * The key a passage of a chart is in.
 *
 * Working out a degree name needs only the tonic; see `degree.ts` for why the
 * mode does not come into it. The mode is read by {@link inferKey}, which has
 * to choose between a key and its relative, and a notation that cases its
 * numerals would need it too.
 */
export interface Key {
  readonly tonic: Note;
  readonly mode: Mode;
}

/** Where a key came from, which decides whether the user may override it. */
export type KeySource = 'page' | 'inferred' | 'manual';

/**
 * A key and everything after it, up to the next one.
 *
 * A chart is not in one key: a chord chart can state a new key part way
 * through, and several of them do. Keys are therefore a sequence in document
 * order rather than a single value, and a chart that states one key or none
 * is the same sequence with one entry or none. Nothing builds these yet; the
 * site adapter and the content script will.
 */
export interface KeyRegion {
  readonly key: Key;
  readonly source: KeySource;
}

/**
 * Parses a key as a chart names one: a note, and an `m` for a minor key.
 *
 * This is the name alone. Pulling the name out of whatever a site wraps it in
 * belongs to that site's adapter.
 */
export function parseKey(text: string): Key | null {
  const read = readNotePrefix(text.trim());
  if (!read) return null;
  if (read.rest === '') return { tonic: read.note, mode: 'major' };
  if (read.rest === 'm') return { tonic: read.note, mode: 'minor' };
  return null;
}

export function formatKey(key: Key): string {
  return formatNote(key.tonic) + (key.mode === 'minor' ? 'm' : '');
}

/**
 * The triad a chord is built on, as far as key inference needs to know.
 *
 * Everywhere else the quality is left uninterpreted, because a wrong reading
 * of it would put a wrong name on the page. Here a wrong reading costs a
 * point in a score, and refusing to read any of them would leave nothing to
 * score at all, so this makes the one judgement it needs and admits to not
 * knowing the rest.
 */
type Triad = 'major' | 'minor' | 'diminished' | 'augmented';

const HALF_DIMINISHED = /^m(in)?7?[-b♭−]5/;

function triadOf(quality: string): Triad | null {
  if (quality === '') return 'major';
  if (startsWithAny(quality, ['dim', '°', 'ø', 'Ø'])) return 'diminished';
  if (startsWithAny(quality, ['aug', '+'])) return 'augmented';
  // A suspended or a power chord states no third, so it fits every key
  // equally and is evidence for none of them.
  if (startsWithAny(quality, ['sus', '5'])) return null;
  if (startsWithAny(quality, ['maj', 'M', 'Δ', '△', '∆'])) return 'major';
  if (quality.startsWith('m')) return HALF_DIMINISHED.test(quality) ? 'diminished' : 'minor';
  if (startsWithAny(quality, ['add', '6', '7', '9', '11', '13'])) return 'major';
  return null;
}

function startsWithAny(text: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => text.startsWith(prefix));
}

/** Semitones above the tonic paired with the triad built there. */
const DIATONIC: Record<Mode, readonly (readonly [number, Triad])[]> = {
  major: [
    [0, 'major'],
    [2, 'minor'],
    [4, 'minor'],
    [5, 'major'],
    [7, 'major'],
    [9, 'minor'],
    [11, 'diminished'],
  ],
  // The natural minor, plus the two chords a minor key borrows from the
  // harmonic minor often enough that leaving them out would misread most
  // minor charts: the major fifth and the diminished seventh.
  minor: [
    [0, 'minor'],
    [2, 'diminished'],
    [3, 'major'],
    [5, 'minor'],
    [7, 'minor'],
    [7, 'major'],
    [8, 'major'],
    [10, 'major'],
    [11, 'diminished'],
  ],
};

/** Flat-preferring spelling per pitch class, for when the chart offers none. */
const CANONICAL_TONIC = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface KeyGuess {
  readonly key: Key;
  /** Zero to one. See {@link inferKey} for what it is measuring. */
  readonly confidence: number;
}

/**
 * A chart has to offer at least this many different chords before its key is
 * worth guessing at. Two chords fit too many keys to tell them apart.
 */
const MIN_DISTINCT_CHORDS = 3;

/**
 * The margin, in points, at which one key is taken to be clearly ahead of the
 * next. Being first and last in the chart is worth two points on its own, so
 * a key three points ahead is ahead on the chords as well as on that.
 */
const CLEAR_MARGIN = 3;

/** Below this, {@link inferKey} declines rather than guessing. */
export const MIN_CONFIDENCE = 0.5;

/**
 * Guesses which key a sequence of chords is in, or declines.
 *
 * Every one of the twenty-four keys is scored on how many of the chart's
 * distinct chords it accounts for, with two points for a chart that opens and
 * closes on the key's own tonic. That second part is what separates a key
 * from its relative, which share every chord and can never be told apart by
 * the chords alone.
 *
 * The confidence is how well the winning key accounts for the chart,
 * discounted by how close the runner-up came. Both matter: a key that
 * explains half the chords is a poor guess however far ahead it is, and a key
 * that explains all of them is still a guess if another key explains them
 * just as well.
 *
 * **Declining is a normal outcome, not a failure.** A chart that offers no
 * way to choose between three keys really does not say which it is in, and a
 * chart left in chord names is a far better result than a chart confidently
 * relabelled against the wrong tonic. Callers should treat null as "leave
 * this alone" and, where there is a person to ask, ask them.
 */
export function inferKey(chords: readonly ChordSymbol[]): KeyGuess | null {
  const sounds = chords
    .map((chord) => {
      const triad = triadOf(chord.quality);
      return triad ? { pitch: pitchClass(chord.root), triad } : null;
    })
    .filter((sound) => sound !== null);

  const distinct = new Map(sounds.map((sound) => [`${sound.pitch}:${sound.triad}`, sound]));
  if (distinct.size < MIN_DISTINCT_CHORDS) return null;

  const opening = sounds.at(0)?.pitch;
  const closing = sounds.at(-1)?.pitch;

  const scored = candidates().map((key) => {
    const tonic = pitchClass(key.tonic);
    const accounted = [...distinct.values()].filter((sound) => isDiatonic(sound, tonic, key.mode));
    const bonus = (opening === tonic ? 1 : 0) + (closing === tonic ? 1 : 0);
    return { key, fit: accounted.length / distinct.size, total: accounted.length + bonus };
  });
  scored.sort((one, other) => other.total - one.total);

  const [best, runnerUp] = scored;
  if (!best || !runnerUp) return null;

  const margin = Math.min(1, (best.total - runnerUp.total) / CLEAR_MARGIN);
  const confidence = best.fit * margin;
  if (confidence < MIN_CONFIDENCE) return null;

  return { key: { ...best.key, tonic: spellTonic(best.key.tonic, chords) }, confidence };
}

function candidates(): Key[] {
  const modes: Mode[] = ['major', 'minor'];
  return CANONICAL_TONIC.flatMap((name, pitch) => {
    const tonic = parseNote(name);
    if (!tonic) throw new Error(`${name} at pitch class ${pitch} is not a note`);
    return modes.map((mode) => ({ tonic, mode }));
  });
}

function isDiatonic(sound: { pitch: number; triad: Triad }, tonic: number, mode: Mode): boolean {
  const semitones = (sound.pitch - tonic + 12) % 12;
  return DIATONIC[mode].some(([step, triad]) => step === semitones && triad === sound.triad);
}

/**
 * Spells the tonic the way the chart spells that pitch, falling back to the
 * canonical spelling when no chord names it. A chart full of `F#` should not
 * come back as being in G flat.
 */
function spellTonic(tonic: Note, chords: readonly ChordSymbol[]): Note {
  const pitch = pitchClass(tonic);
  const named = chords.find((chord) => pitchClass(chord.root) === pitch);
  return named ? named.root : tonic;
}
