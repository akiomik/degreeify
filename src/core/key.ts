import { type ChordSymbol, DASH_MARKS, PLUS_MARKS, TRIANGLE_MARKS } from './chord';
import {
  FLAT_CHARS,
  formatNote,
  type Note,
  parseNote,
  pitchClass,
  readNotePrefix,
  SHARP_CHARS,
} from './pitch';

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
 * The marks that lower and raise a note, taken from the lists that already
 * say what a flat, a sharp and a dash may be written as, so that a spelling
 * the parser accepts cannot be one this file fails to read.
 */
const FLATTENING_MARKS = DASH_MARKS + FLAT_CHARS;
const RAISING_MARKS = PLUS_MARKS + SHARP_CHARS;

/**
 * Whether a quality alters its fifth: `7-5`, `m7b5`, `m7(b5)`, `7#5`. The
 * mark is looked for against the five it belongs to, and nowhere in
 * particular otherwise, since the quality comes through as the chart wrote it
 * and charts put it in several places. Tying it to the five is also what
 * keeps an altered eleventh, `M7(#11)`, from being read as one.
 *
 * The quality must already be lower-cased. A flat is written `b` as often as
 * `♭`, and a chart that shouts its chord names would otherwise slip past.
 */
function hasFifth(word: string, marks: string): boolean {
  return [...marks].some((mark) => word.includes(`${mark}5`));
}

const hasFlatFifth = (word: string) => hasFifth(word, FLATTENING_MARKS);

/**
 * What a chord with a major third is, once its fifth is taken into account.
 *
 * A raised fifth makes an augmented triad, whatever else the quality says, so
 * `M7#5` and `7(#5)` are augmented rather than major. A lowered one makes
 * nothing that has a name: no triad puts a major third under a diminished
 * fifth, and calling it diminished would let it stand in for a leading-tone
 * chord it sounds nothing like. There is nothing to say about it, so nothing
 * is said.
 */
function majorOrAltered(word: string): Triad | null {
  if (hasFifth(word, RAISING_MARKS)) return 'augmented';
  if (hasFlatFifth(word)) return null;
  return 'major';
}

/**
 * How a quality can begin and mean a minor third once the ones spelled as a
 * word have been dealt with: an `m`, or the dash a jazz lead sheet writes
 * `C-7` with where a chart elsewhere writes `Cm7`.
 */
const MINOR_MARKS = ['m', ...DASH_MARKS];

/**
 * Reads the triad a quality describes.
 *
 * Case carries meaning in exactly one place, `M` against `m`, so everything
 * spelled as a word is matched against a lower-cased copy and only those two
 * are matched as written. Without that, `C7SUS4` counts as evidence for a
 * major key — the opposite of what a suspension is — and `CMI7` reads as a
 * major seventh rather than as a minor chord.
 *
 * `mi` and `min` are settled before `maj` and `M` for the same reason: they
 * all begin with the same letter, and whichever is tested first wins.
 */
function triadOf(quality: string): Triad | null {
  if (quality === '') return 'major';

  const word = quality.toLowerCase();
  if (startsWithAny(word, ['dim', '°', 'ø'])) return 'diminished';
  if (startsWithAny(word, ['aug', ...PLUS_MARKS])) return 'augmented';
  // A suspended or a power chord states no third, so it fits every key
  // equally and is evidence for none of them. `sus` is looked for anywhere in
  // the quality because `7sus4` is as common as `sus4`.
  if (word.includes('sus') || word.startsWith('5')) return null;
  // `mi` covers `min` and `mi7` alike, and `ma` covers `maj7` and the fake
  // book's `ma7`. Both are settled before the bare `m` that they all begin
  // with, and before the `M` that says major on its own. `madd9` is not one
  // of them — that is a minor chord with an added ninth, and the `ma` it
  // opens with belongs to two different parts of the quality.
  if (word.startsWith('mi')) return hasFlatFifth(word) ? 'diminished' : 'minor';
  if (word.startsWith('ma') && !word.startsWith('madd')) return majorOrAltered(word);
  // Lower-casing a triangle turns the Greek delta into a different letter, so
  // these are read as written — as `M` has to be in any case.
  if (startsWithAny(quality, ['M', ...TRIANGLE_MARKS])) return majorOrAltered(word);
  if (startsWithAny(quality, MINOR_MARKS)) {
    return hasFlatFifth(word) ? 'diminished' : 'minor';
  }
  // A quality that opens with a bracket says nothing before it, so the triad
  // is the plain one the root names: `C(9)` is a C major triad with a ninth.
  if (startsWithAny(word, ['add', '(', '6', '7', '9', '11', '13'])) return majorOrAltered(word);
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
 * third all come from that.
 *
 * A major key borrows as well, and what it borrows from the parallel minor —
 * a major third, sixth and seventh, and a minor fourth — is likewise beyond
 * its relative minor's reach. Those are left off deliberately rather than
 * because they do not exist. Listing them widens what a single major key can
 * account for far enough that a chart with no single key is explained by one:
 * the chart to hand that changes key seven times comes back as G major, at a
 * confidence that would have been acted on. Leaving them off costs confidence
 * on a chart that borrows, which is the safe direction to be wrong in.
 *
 * These are accounted for, at {@link MODAL_WEIGHT} of a chord each. Counting
 * them in full would put a mode back to accounting for everything its
 * relative does and more, which is the arrangement {@link DIATONIC} exists to
 * avoid; not counting them at all would mean a minor key failing to explain
 * its own dominant, dragging its fit down and handing the chart to the
 * parallel major, where those same chords are plain scale.
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
 * What a chord only one of two relatives has counts for, as a fraction of a
 * chord. Half: it says which of the pair a chart is in, but not on its own —
 * a major fifth is as often a secondary dominant in the relative major as it
 * is a real dominant in the minor.
 */
const MODAL_WEIGHT = 0.5;

/**
 * The margin, in points, at which one key is taken to be clearly ahead of the
 * next. Opening and closing on a tonic is worth two, so this is the point
 * where the evidence for a tonic is unopposed.
 */
const CLEAR_MARGIN = 2;

/**
 * Below this, {@link inferKey} declines rather than guessing.
 *
 * The value is a description rather than a dial: at a {@link CLEAR_MARGIN} of
 * two, a half is exactly one end of the chart landing on the tonic against a
 * fit that leaves nothing unaccounted for. That is the least evidence worth
 * naming a key on, and it is meant to be included rather than excluded.
 */
export const MIN_CONFIDENCE = 0.5;

/** The triad a key is named after, which is what its tonic chord sounds like. */
const TONIC_TRIAD: Record<Mode, Triad> = { major: 'major', minor: 'minor' };

/**
 * Guesses which key a sequence of chords is in, or declines.
 *
 * Every one of the twenty-four keys is scored on how many of the chart's
 * distinct chords it accounts for, with a point each for opening and closing
 * the chart on the key's own tonic chord. A chord only one of two relatives
 * has counts for part of one, which along with the ends of the chart is all
 * that separates relatives: they share every chord of the plain scale and can
 * never be told apart by fit alone.
 *
 * The confidence is how well the winning key accounts for the chart,
 * discounted by how close the nearest key on a different tonic came. Both
 * matter: a key that explains half the chords is a poor guess however far
 * ahead it is, and a key that explains all of them is still a guess if
 * another key explains them just as well. Only a different tonic counts as
 * another key here, since a degree name is drawn from the tonic alone.
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

  // Read from every chord rather than only the ones whose triad could be made
  // out: a chart opening on a power chord still opens where it opens.
  const opening = endOf(chords, 0);
  const closing = endOf(chords, -1);

  const scored = candidates().map((key) => {
    const tonic = pitchClass(key.tonic);
    const plain = distinct.filter((sound) => isIn(DIATONIC[key.mode], sound, tonic)).length;
    const modal = distinct.filter((sound) => isIn(MODAL[key.mode], sound, tonic)).length;
    const accounted = plain + modal * MODAL_WEIGHT;
    const bookends =
      (isTonicChord(opening, tonic) ? BOOKEND_POINTS : 0) +
      (isTonicChord(closing, tonic) ? BOOKEND_POINTS : 0);
    const spelled = agreesWithMode(opening, key, tonic) || agreesWithMode(closing, key, tonic);
    return { key, fit: accounted / distinct.length, total: accounted + bookends, spelled };
  });
  // Where two keys come out level, the one the chart spells its tonic chord
  // as wins. That only ever separates a pair on the same tonic — anything
  // else has already been settled by the chords.
  scored.sort(
    (one, other) => other.total - one.total || Number(other.spelled) - Number(one.spelled),
  );

  // The runner-up is the best candidate that would name the chords
  // differently. Two keys on the same tonic disagree only about the mode,
  // which no degree name is drawn from, so one of them beating the other by a
  // hair is not a reason to leave the chart alone.
  const [best] = scored;
  if (!best) return null;
  const bestTonic = pitchClass(best.key.tonic);
  const runnerUp = scored.find((other) => pitchClass(other.key.tonic) !== bestTonic);
  if (!runnerUp) return null;

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

interface Sound {
  readonly pitch: number;
  readonly triad: Triad | null;
}

function endOf(chords: readonly ChordSymbol[], index: number): Sound | null {
  const chord = chords.at(index);
  return chord ? { pitch: pitchClass(chord.root), triad: triadOf(chord.quality) } : null;
}

/**
 * Whether an end of the chart is rooted on the key's tonic.
 *
 * The root alone, because that is what coming to rest somewhere means. A
 * chart that ends on `I+` or on the major chord a minor key finishes on is
 * resting on its tonic every bit as much as one ending on the plain triad,
 * and asking the triad to agree here would give those endings nothing while
 * the very same chord still counts towards a rival key's chords.
 */
function isTonicChord(end: Sound | null, tonic: number): boolean {
  return end !== null && end.pitch === tonic;
}

/**
 * Whether an end of the chart is the key's tonic chord spelled as the key
 * would spell it.
 *
 * Nothing is scored on this. It separates two keys on the same tonic that
 * have come out level, where the chords cannot: a chart resting on `Am` is in
 * A minor rather than A major, whatever else the two of them share. A chord
 * whose triad cannot be read settles nothing either way.
 */
function agreesWithMode(end: Sound | null, key: Key, tonic: number): boolean {
  return isTonicChord(end, tonic) && end?.triad === TONIC_TRIAD[key.mode];
}

function isIn(table: readonly Chord[], sound: Sound, tonic: number) {
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
