/**
 * Note names as a letter plus an accidental.
 *
 * Spelling is kept all the way through: `F#` and `Gb` sound the same but are
 * different notes here, because collapsing them to a pitch class would make
 * `#IV` and `bV` indistinguishable downstream.
 */

/** The seven natural letters, in scale order from C. */
export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

export type Letter = (typeof LETTERS)[number];

/** -2 = double flat, -1 = flat, 0 = natural, +1 = sharp, +2 = double sharp. */
export type Accidental = -2 | -1 | 0 | 1 | 2;

export interface Note {
  readonly letter: Letter;
  readonly accidental: Accidental;
}

const NATURAL_PITCH_CLASSES: Record<Letter, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/**
 * Every character that raises a note, and every character that lowers one.
 *
 * These have to cover at least the accidentals a chord quality is allowed to
 * contain. A character that is allowed in a quality but not recognised here
 * would be read as the start of a quality when it turns up after the root,
 * which relabels the chord rather than leaving it alone.
 */
const SHARP_CHARS = '#♯＃';
const FLAT_CHARS = 'b♭';

export function isLetter(value: string): value is Letter {
  return (LETTERS as readonly string[]).includes(value);
}

/** Position of `letter` in {@link LETTERS}, i.e. the degree it spells. */
export function letterIndex(letter: Letter): number {
  return LETTERS.indexOf(letter);
}

/** The note's pitch class, 0 (C) to 11 (B). */
export function pitchClass(note: Note): number {
  return (NATURAL_PITCH_CLASSES[note.letter] + note.accidental + 12) % 12;
}

export function formatNote(note: Note): string {
  const { accidental } = note;
  const mark = accidental < 0 ? 'b' : '#';
  return note.letter + mark.repeat(Math.abs(accidental));
}

/**
 * Reads a note off the front of `text`, returning it with whatever follows.
 *
 * The letter must be upper case, as it is everywhere the supported sites
 * write chords. Accidentals are greedy: `Gb` reads as G flat, never as G
 * followed by a `b`. A run of more than two accidental characters, or a mix
 * of sharps and flats, is not a note.
 */
export function readNotePrefix(text: string): { note: Note; rest: string } | null {
  const letter = text.charAt(0);
  if (!isLetter(letter)) return null;

  let step = 0;
  let index = 1;
  for (; index < text.length; index++) {
    const char = text.charAt(index);
    const direction = SHARP_CHARS.includes(char) ? 1 : FLAT_CHARS.includes(char) ? -1 : 0;
    if (direction === 0) break;
    if (step !== 0 && Math.sign(step) !== direction) return null;
    step += direction;
  }
  if (step < -2 || step > 2) return null;

  return {
    note: { letter, accidental: step as Accidental },
    rest: text.slice(index),
  };
}

/** Parses a note that makes up the whole of `text`. */
export function parseNote(text: string): Note | null {
  const read = readNotePrefix(text);
  return read && read.rest === '' ? read.note : null;
}
