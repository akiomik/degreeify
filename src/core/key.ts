import { type ChordSymbol, DASH_LOOKALIKES, DASH_MARKS, PLUS_MARKS, TRIANGLE_MARKS } from './chord';
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
 * A key, and where it came from.
 *
 * A chart is not in one key: a chord chart can state a new key part way
 * through, and several of them do. What follows one of these, up to the next,
 * is in the key it names — but that is a fact about the sequence it is read
 * from rather than about this, which says nothing about where in a chart it
 * sits. It is the reader's job to keep them in document order and to know
 * which chords fell between which two.
 *
 * Nothing builds these yet; the site adapter and the content script will.
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
const FLATTENING_MARKS = DASH_MARKS + DASH_LOOKALIKES + FLAT_CHARS;
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

/**
 * What a chord is, once an altered fifth is taken into account.
 *
 * A third and a fifth can be put together four ways and only two of them have
 * a name: a major third under a raised fifth is an augmented triad, a minor
 * third under a lowered one is diminished. The other two are not triads at
 * all. Nothing is said about those, because the nearest name is a chord they
 * sound nothing like — read `C(b5)` as diminished and it stands in for the
 * leading-tone chord of two keys it has no business in.
 *
 * The fifth has to be looked at on both sides. Reading it only under a major
 * third leaves `Cm7#5` as a plain minor chord while `CM7#5` is augmented,
 * which is the same quality mark taken two different ways.
 *
 * What is passed in is the quality after the mark naming the third, so that a
 * mark cannot be read twice. The dash of `C-5` says minor and is then gone;
 * left in, it would be found again against the five and make a diminished
 * triad out of a chord that says no such thing.
 */
function withFifth(rest: string, third: 'major' | 'minor'): Triad | null {
  if (raisesFifth(rest)) return third === 'major' ? 'augmented' : null;
  if (hasFifth(rest, FLATTENING_MARKS)) return third === 'major' ? null : 'diminished';
  return third;
}

/**
 * Ways a quality says the chord has no third: something is suspended in place
 * of one, or the third is struck out by name. A chord that states no third
 * fits every key equally and is evidence for none of them.
 *
 * `no3` and `omit3` came out right before this was written down, by falling
 * off the end of every branch and reaching the same answer by accident. In
 * brackets, which is how they are usually written, they were read as plain
 * major triads instead.
 */
const NO_THIRD_WORDS = ['sus', 'no3', 'omit3'];

/**
 * How a quality can say the chord is a bare fifth, in brackets or out of
 * them. `(#5)` and `(b5)` are not this: those alter a fifth over a third
 * rather than standing in for the whole chord.
 */
const BARE_FIFTHS = ['5', '(5)'];

/**
 * How a quality spells a third as a word: `mi`, `min` and `mi7` all begin the
 * one way, `ma`, `maj7` and the fake book's `ma7` the other.
 */
const MINOR_WORD = 'mi';
const MAJOR_WORD = 'ma';

/** How a quality names a major third with a mark rather than a word. */
const MAJOR_MARKS = ['M', ...TRIANGLE_MARKS];

/**
 * How a quality can begin and mean a minor third once the ones spelled as a
 * word have been dealt with: an `m`, or the dash a jazz lead sheet writes
 * `C-7` with where a chart elsewhere writes `Cm7`.
 *
 * The dashes proper only. A quality is allowed to hold what a Japanese
 * keyboard puts where a dash would go, and `m7ー5` reads as a flattened fifth
 * because everything around it says so — but a chord opening with one has
 * nothing saying that, and a character permitted as a look-alike does not get
 * to mean a minor third on its own.
 */
const MINOR_MARK_LETTER = 'm';
const MINOR_MARKS = [MINOR_MARK_LETTER, ...DASH_MARKS];

/**
 * Whether what follows the mark naming the third raises the fifth.
 *
 * A plus with nothing after it does: `C7+`. Against a number it raises that
 * number, so `7+9` is a raised ninth and no business of this. So does the
 * word, which is how `C7aug` says what `C7#5` says — at the front of a
 * quality that word names the whole triad, but here there is already a third
 * for it to be read against.
 */
function raisesFifth(rest: string): boolean {
  return (
    hasFifth(rest, RAISING_MARKS) ||
    rest.includes('aug') ||
    [...PLUS_MARKS].some((plus) => rest.endsWith(plus))
  );
}

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

  // A word naming the whole triad says so from the front, where there is no
  // third in front of it to be read against. Further in, `aug` and the plus
  // are marks on the fifth like any other, and {@link withFifth} reads them
  // with the third — so `7aug` is augmented and `m7aug` is the nameless thing
  // `m7#5` is.
  if (includesAny(word, ['dim', '°', 'ø'])) return 'diminished';
  if (startsWithAny(word, ['aug', ...PLUS_MARKS])) return 'augmented';
  if (includesAny(word, NO_THIRD_WORDS) || startsWithAny(word, BARE_FIFTHS)) return null;

  // An `m` in front of an `add` is a minor chord with something added, not
  // the `ma` that says major. Which it is comes down to the case of that one
  // letter, so a quality shouted in capitals cannot say.
  if (word.startsWith(`${MINOR_MARK_LETTER}add`)) {
    // Which of the two it is rests on the case of that one letter and on
    // nothing after it, so a quality with no lower case left anywhere in it
    // has had the answer shouted away.
    if (quality === quality.toUpperCase()) return null;
    const third = quality.startsWith(MINOR_MARK_LETTER) ? 'minor' : 'major';
    return withFifth(after(quality, MINOR_MARK_LETTER), third);
  }

  // `mi` covers `min` and `mi7` alike, and `ma` covers `maj7` and the fake
  // book's `ma7`. Both are settled before the bare `m` that they all begin
  // with, and before the `M` that says major on its own.
  if (word.startsWith(MINOR_WORD)) return withFifth(after(word, MINOR_WORD), 'minor');
  if (word.startsWith(MAJOR_WORD)) return withFifth(after(word, MAJOR_WORD), 'major');
  // Lower-casing a triangle turns the Greek delta into a different letter, so
  // these are read as written — as `M` has to be in any case.
  const majorMark = leadingMark(quality, MAJOR_MARKS);
  if (majorMark) return withFifth(after(quality, majorMark), 'major');
  const minorMark = leadingMark(quality, MINOR_MARKS);
  if (minorMark) return withFifth(after(quality, minorMark), 'minor');
  // A quality that opens with a bracket says nothing before it, so the triad
  // is the plain one the root names: `C(9)` is a C major triad with a ninth.
  if (startsWithAny(word, ['add', '(', '6', '7', '9', '11', '13'])) return withFifth(word, 'major');
  return null;
}

function startsWithAny(text: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => text.startsWith(prefix));
}

/**
 * The first of `marks` that `text` begins with.
 *
 * What is returned is the mark itself rather than a yes, so that a caller
 * reading what comes after it can take that many characters off instead of
 * assuming a length. The lists these come from are shared with the parser and
 * meant to grow, and one grown by a mark written with a surrogate pair would
 * be cut in half by a fixed count.
 */
function leadingMark(text: string, marks: readonly string[]): string | undefined {
  return marks.find((mark) => text.startsWith(mark));
}

/**
 * What follows a mark at the front of `text`, lower-cased for reading.
 *
 * The mark is taken off the string it was found in rather than off a copy of
 * it, because lower-casing is not obliged to leave a string the same length —
 * and a mark measured against one string and removed from another only works
 * while none of them changes size.
 */
function after(text: string, mark: string): string {
  return text.slice(mark.length).toLowerCase();
}

function includesAny(text: string, parts: readonly string[]): boolean {
  return parts.some((part) => text.includes(part));
}

/*
 * An augmented chord is read rather than set aside, even though the only key
 * that accounts for it is the minor one whose raised third it is, so against
 * every other candidate it counts against.
 *
 * A quality that states no third, and one that cannot be read at all, are set
 * aside because there is nothing to say about them. An augmented chord is not
 * in that position: it is known, and known to be outside every scale, and a
 * chart full of chords outside every scale really is a chart whose key its
 * chords do not settle. Counting it lowers confidence nearly everywhere
 * rather than putting a candidate ahead, which is the right direction to fail
 * in.
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
  /**
   * Zero to one, and about the tonic rather than the whole key.
   *
   * A degree name is drawn from the tonic alone, so that is what {@link
   * inferKey} weighs and what this reports. The mode is the better-supported
   * of the two readings on that tonic and no more: it changes nothing about
   * the names a chart is given, but {@link formatKey} does render it, and a
   * caller putting the key in front of someone is showing them something this
   * number does not vouch for.
   */
  readonly confidence: number;
}

/**
 * A chart has to offer at least this many different chords before its key is
 * worth guessing at. Two chords fit too many keys to tell them apart.
 */
const MIN_DISTINCT_CHORDS = 3;

/**
 * What each end of the chart is worth when it rests on the key's tonic,
 * counted in chords — the same unit everything else on the scoreboard is in,
 * so that the two can be weighed against each other.
 *
 * Closing on the tonic is worth about as much as one more chord accounted
 * for; opening on it, about half that. A chart is in the key it arrives at,
 * and where it sets out from is a weaker claim on the same question.
 *
 * Both were once worth twice this, which made the ends of a chart heavy
 * enough to outweigh the chords: `C - F - G - Am - F` was given up on,
 * because F major closing the chart beat C major accounting for every chord
 * in it. Where a chart ends says a great deal, but not more than what the
 * chart is made of.
 */
const OPENING_POINTS = 0.5;
const CLOSING_POINTS = 1;

/**
 * What a chord only one of two relatives has counts for, as a fraction of a
 * chord. Half: it says which of the pair a chart is in, but not on its own —
 * a major fifth is as often a secondary dominant in the relative major as it
 * is a real dominant in the minor.
 */
const MODAL_WEIGHT = 0.5;

/**
 * The margin, in chords, at which one key is taken to be clearly ahead of the
 * next. One: the point where the strongest single piece of evidence for a key
 * — a chord it accounts for and the other does not, or the ending of the
 * chart — stands unopposed.
 */
const CLEAR_MARGIN = 1;

/**
 * Below this, {@link inferKey} declines rather than guessing.
 *
 * The value is a description rather than a dial: against a {@link
 * CLEAR_MARGIN} of one chord, a half is exactly the opening of the chart
 * landing on the tonic with a fit that leaves nothing unaccounted for. That
 * is the least evidence worth naming a key on, and it is meant to be included
 * rather than excluded.
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
 * another key here, since a degree name is drawn from the tonic alone — which
 * is also why the confidence says nothing about the mode. See
 * {@link KeyGuess.confidence}.
 *
 * **Declining is a normal outcome, not a failure.** A chart that offers no
 * way to choose between three keys really does not say which it is in, and a
 * chart left in chord names is a far better result than a chart confidently
 * relabelled against the wrong tonic. Callers should treat null as "leave
 * this alone" and, where there is a person to ask, ask them.
 */
export function inferKey(chords: readonly ChordSymbol[]): KeyGuess | null {
  // A chord in brackets is one offered rather than one the chart is made of,
  // and a chord that may never be played must not be able to take away an
  // answer the rest of them have already given. It says nothing about which
  // key accounts for the chart and nothing about where the chart comes to
  // rest, so it is left out of both.
  const played = chords.filter((chord) => chord.wrapper === 'none');

  const sounds = played
    .map((chord) => {
      const triad = triadOf(chord.quality);
      return triad ? { pitch: pitchClass(chord.root), triad } : null;
    })
    .filter((sound) => sound !== null);

  const distinct = [
    ...new Map(sounds.map((sound) => [`${sound.pitch}:${sound.triad}`, sound])).values(),
  ];
  if (distinct.length < MIN_DISTINCT_CHORDS) return null;

  // Read from the chords whose triad could not be made out as well: a chart
  // opening on a power chord still opens where it opens.
  const opening = endOf(played, 0);
  const closing = endOf(played, -1);

  const scored = candidates().map((key) => {
    const tonic = pitchClass(key.tonic);
    const plain = distinct.filter((sound) => isIn(DIATONIC[key.mode], sound, tonic)).length;
    const modal = distinct.filter((sound) => isIn(MODAL[key.mode], sound, tonic)).length;
    const accounted = plain + modal * MODAL_WEIGHT;
    const bookends =
      (isTonicChord(opening, tonic) ? OPENING_POINTS : 0) +
      (isTonicChord(closing, tonic) ? CLOSING_POINTS : 0);
    const spelled = modeAgreement(opening, closing, key, tonic);
    return { key, fit: accounted / distinct.length, total: accounted + bookends, spelled };
  });
  // Where two keys come out level, the one the chart spells its tonic chord
  // as goes first. It is only ever a pair on the same tonic that this decides
  // anything for: two keys on different tonics coming out level is a margin
  // of nothing, and the chart is given up on whichever of them is put first.
  scored.sort((one, other) => other.total - one.total || other.spelled - one.spelled);

  // The runner-up is the best candidate that would name the chords
  // differently. Two keys on the same tonic disagree only about the mode,
  // which no degree name is drawn from, so one of them beating the other by a
  // hair is not a reason to leave the chart alone.
  const [best] = scored;
  if (!best) return null;
  const bestTonic = pitchClass(best.key.tonic);
  const runnerUp = scored.find((other) => pitchClass(other.key.tonic) !== bestTonic);
  // Unreachable: the candidates span all twelve tonics, so one of them always
  // differs from the winner's. It is here because the type says otherwise,
  // and the alternative is asserting it away.
  if (!runnerUp) return null;

  const margin = Math.min(1, (best.total - runnerUp.total) / CLEAR_MARGIN);
  const confidence = best.fit * margin;
  if (confidence < MIN_CONFIDENCE) return null;

  return { key: { ...best.key, tonic: spellTonic(best.key.tonic, played) }, confidence };
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
 * How far the ends of the chart agree that the key is in the mode it claims.
 *
 * Nothing is scored on this. It separates two keys on the same tonic that
 * have come out level, where the chords cannot: a chart resting on `Am` is in
 * A minor rather than A major, whatever else the two of them share. A chord
 * whose triad cannot be read settles nothing either way.
 *
 * The two ends are weighed against each other rather than taken together,
 * for the same reason they are worth different amounts elsewhere. A chart
 * opening on `C` and closing on `Cm` speaks for both modes, and taking either
 * as enough leaves the pair tied again, which is what this exists to break.
 */
function modeAgreement(opening: Sound | null, closing: Sound | null, key: Key, tonic: number) {
  const agrees = (end: Sound | null) =>
    isTonicChord(end, tonic) && end?.triad === TONIC_TRIAD[key.mode];
  return (agrees(closing) ? CLOSING_POINTS : 0) + (agrees(opening) ? OPENING_POINTS : 0);
}

function isIn(table: readonly Chord[], sound: Sound, tonic: number) {
  const semitones = (sound.pitch - tonic + 12) % 12;
  return table.some(([step, triad]) => step === semitones && triad === sound.triad);
}

/**
 * How many accidentals a note may carry and still name a key.
 *
 * One. A chart spelling a pitch with two is spelling a chord that passes
 * through it, and no key is named that way — nobody is in E double sharp.
 */
const MOST_ACCIDENTALS_IN_A_KEY_NAME = 1;

/**
 * Spells the tonic the way the chart spells that pitch most often, falling
 * back to the canonical spelling when no chord names it that way. A chart
 * full of `F#` should not come back as being in G flat, one `Gb` among thirty
 * `F#` should not decide it either, and a passing `E##` should not name the
 * key at all.
 */
function spellTonic(tonic: Note, chords: readonly ChordSymbol[]): Note {
  const pitch = pitchClass(tonic);
  const spellings = new Map<string, { note: Note; count: number }>();
  for (const chord of chords) {
    if (pitchClass(chord.root) !== pitch) continue;
    if (Math.abs(chord.root.accidental) > MOST_ACCIDENTALS_IN_A_KEY_NAME) continue;
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
