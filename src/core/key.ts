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

/**
 * A flattened fifth anywhere in a minor quality, which makes the triad
 * diminished: `m7-5`, `m7b5`, `m7(b5)`. The alteration is not anchored to a
 * position because the quality is carried through as the chart wrote it, and
 * charts write all three, in any of the spellings of a flat.
 */
const FLAT_FIFTH = /[-b♭−－ー]\s*5/;

/** A chord that states no third, wherever the word appears in the quality. */
const NO_THIRD = /sus/;

function triadOf(quality: string): Triad | null {
  if (quality === '') return 'major';
  if (startsWithAny(quality, ['dim', '°', 'ø', 'Ø'])) return 'diminished';
  if (startsWithAny(quality, ['aug', '+'])) return 'augmented';
  // A suspended or a power chord states no third, so it fits every key
  // equally and is evidence for none of them. `sus` is looked for anywhere in
  // the quality because `7sus4` is as common as `sus4`.
  if (NO_THIRD.test(quality) || quality.startsWith('5')) return null;
  if (startsWithAny(quality, ['maj', 'M', 'Δ', '△', '∆'])) return 'major';
  if (quality.startsWith('m')) return FLAT_FIFTH.test(quality) ? 'diminished' : 'minor';
  if (startsWithAny(quality, ['add', '6', '7', '9', '11', '13'])) return 'major';
  return null;
}

function startsWithAny(text: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => text.startsWith(prefix));
}

/*
 * An augmented chord is read rather than set aside, even though it belongs to
 * no key's plain scale and so counts against every candidate.
 *
 * A quality that states no third, and one that cannot be read at all, are set
 * aside because there is nothing to say about them. An augmented chord is not
 * in that position: it is known, and known to be outside every scale, and a
 * chart full of chords outside every scale really is a chart whose key its
 * chords do not settle. Counting it lowers confidence rather than moving any
 * candidate ahead of another, which is the right direction to fail in.
 *
 * The cost is bounded and the alternative is worse. A chart carrying one or
 * two of them among its diatonic chords is still named; only one made mostly
 * of them declines. Setting them aside instead makes the most chromatic chart
 * to hand come back with the wrong tonic at a confidence that would have been
 * acted on.
 */

type Chord = readonly [semitones: number, triad: Triad];

/**
 * Semitones above the tonic paired with the triad built there, in the plain
 * scale of each mode.
 *
 * These two are the same seven chords read from different tonics, and they
 * have to stay that way. A mode holding chords its relative does not would
 * account for at least as much of every chart ever written, and so would win
 * on chord fit against its relative every time, whatever the chart said.
 */
const DIATONIC: Record<Mode, readonly Chord[]> = {
  major: [
    [0, 'major'],
    [2, 'minor'],
    [4, 'minor'],
    [5, 'major'],
    [7, 'major'],
    [9, 'minor'],
    [11, 'diminished'],
  ],
  minor: [
    [0, 'minor'],
    [2, 'diminished'],
    [3, 'major'],
    [5, 'minor'],
    [7, 'minor'],
    [8, 'major'],
    [10, 'major'],
  ],
};

/**
 * Chords a mode has that its relative does not, which a chart borrows often
 * enough to be worth noticing.
 *
 * A minor key raises its seventh degree far too often for the plain scale to
 * recognise one: the major fifth, the diminished seventh and the augmented
 * third all come from that. A major key borrows too, but nothing it borrows
 * is unavailable to its relative minor, so there is nothing to list.
 *
 * These count as evidence for the mode rather than towards chord fit. Fit is
 * what stays symmetrical between relatives; this is one of the two things
 * that tells them apart.
 */
const MODAL: Record<Mode, readonly Chord[]> = {
  major: [],
  minor: [
    [7, 'major'],
    [11, 'diminished'],
    [3, 'augmented'],
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

/** A point each for opening the chart on the key's tonic and for closing on it. */
const BOOKEND_POINTS = 1;

/**
 * What a chord only one of two relatives has is worth. Half a chord: it says
 * which of the pair a chart is in, but not on its own — a major fifth is as
 * often a secondary dominant in the relative major as it is a real dominant
 * in the minor.
 */
const MODAL_POINTS = 0.5;

/**
 * The margin, in points, at which one key is taken to be clearly ahead of the
 * next. Opening and closing on a tonic is worth two, so this is the point
 * where the evidence for a tonic is unopposed.
 */
const CLEAR_MARGIN = 2;

/** Below this, {@link inferKey} declines rather than guessing. */
export const MIN_CONFIDENCE = 0.5;

/**
 * Guesses which key a sequence of chords is in, or declines.
 *
 * Every one of the twenty-four keys is scored on how many of the chart's
 * distinct chords it accounts for, with a point each for opening and closing
 * the chart on the key's own tonic and a half for a chord only that mode has.
 * Those last two are what separates a key from its relative, which share
 * every chord of the plain scale and can never be told apart by fit alone.
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

  const distinct = [
    ...new Map(sounds.map((sound) => [`${sound.pitch}:${sound.triad}`, sound])).values(),
  ];
  if (distinct.length < MIN_DISTINCT_CHORDS) return null;

  // Which chord opens and closes the chart is about its root alone, so this
  // reads every chord rather than only the ones whose triad could be made
  // out. A chart opening on a power chord still opens where it opens.
  const opening = firstPitch(chords);
  const closing = firstPitch([...chords].reverse());

  const scored = candidates().map((key) => {
    const tonic = pitchClass(key.tonic);
    const accounted = distinct.filter((sound) => isIn(DIATONIC[key.mode], sound, tonic));
    const modal = distinct.some((sound) => isIn(MODAL[key.mode], sound, tonic));
    const bookends =
      (opening === tonic ? BOOKEND_POINTS : 0) + (closing === tonic ? BOOKEND_POINTS : 0);
    return {
      key,
      fit: accounted.length / distinct.length,
      total: accounted.length + bookends + (modal ? MODAL_POINTS : 0),
    };
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

function firstPitch(chords: readonly ChordSymbol[]): number | undefined {
  const chord = chords.at(0);
  return chord && pitchClass(chord.root);
}

function isIn(table: readonly Chord[], sound: { pitch: number; triad: Triad }, tonic: number) {
  const semitones = (sound.pitch - tonic + 12) % 12;
  return table.some(([step, triad]) => step === semitones && triad === sound.triad);
}

/**
 * Spells the tonic the way the chart spells that pitch most often, falling
 * back to the canonical spelling when no chord names it. A chart full of `F#`
 * should not come back as being in G flat, and one `Gb` among thirty `F#`
 * should not decide it either.
 */
function spellTonic(tonic: Note, chords: readonly ChordSymbol[]): Note {
  const pitch = pitchClass(tonic);
  const spellings = new Map<string, { note: Note; count: number }>();
  for (const chord of chords) {
    if (pitchClass(chord.root) !== pitch) continue;
    const name = formatNote(chord.root);
    const seen = spellings.get(name);
    if (seen) seen.count += 1;
    else spellings.set(name, { note: chord.root, count: 1 });
  }

  const commonest = [...spellings.values()].reduce<{ note: Note; count: number } | null>(
    (best, spelling) => (best && best.count >= spelling.count ? best : spelling),
    null,
  );
  return commonest ? commonest.note : tonic;
}
