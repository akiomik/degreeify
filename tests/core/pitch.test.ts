import { describe, expect, it } from 'vitest';
import {
  type Accidental,
  FLAT_CHARS,
  formatNote,
  type Letter,
  letterIndex,
  type Note,
  parseNote,
  pitchClass,
  readNotePrefix,
  SHARP_CHARS,
} from '@/core/pitch';

const note = (letter: Letter, accidental: Accidental = 0): Note => ({ letter, accidental });

describe('letterIndex', () => {
  it('orders the letters from C', () => {
    expect(['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((l) => letterIndex(l as Letter))).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe('pitchClass', () => {
  const cases: [Note, number][] = [
    [note('C'), 0],
    [note('D'), 2],
    [note('E'), 4],
    [note('F'), 5],
    [note('G'), 7],
    [note('A'), 9],
    [note('B'), 11],
    [note('C', 1), 1],
    [note('D', -1), 1],
    [note('F', 1), 6],
    [note('G', -1), 6],
    [note('C', 2), 2],
    [note('E', -2), 2],
  ];

  it.each(cases)('maps %o to %i', (input, expected) => {
    expect(pitchClass(input)).toBe(expected);
  });

  it('wraps around the octave', () => {
    expect(pitchClass(note('B', 1))).toBe(0);
    expect(pitchClass(note('C', -1))).toBe(11);
    expect(pitchClass(note('C', -2))).toBe(10);
  });
});

describe('formatNote', () => {
  const cases: [Note, string][] = [
    [note('C'), 'C'],
    [note('C', 1), 'C#'],
    [note('B', -1), 'Bb'],
    [note('F', 2), 'F##'],
    [note('A', -2), 'Abb'],
  ];

  it.each(cases)('formats %o as %s', (input, expected) => {
    expect(formatNote(input)).toBe(expected);
  });
});

describe('parseNote', () => {
  const accepted: [string, Note][] = [
    ['C', note('C')],
    ['C#', note('C', 1)],
    ['C♯', note('C', 1)],
    ['Db', note('D', -1)],
    ['D♭', note('D', -1)],
    ['F##', note('F', 2)],
    ['B♭♭', note('B', -2)],
  ];

  it.each(accepted)('parses %s', (input, expected) => {
    expect(parseNote(input)).toEqual(expected);
  });

  const rejected = [
    '', // empty
    'H', // not a letter
    'c', // lower case
    'Cm', // trailing quality is not part of a note
    'C#b', // mixed accidentals
    'C###', // more than a double sharp
    '/E',
  ];

  it.each(rejected)('rejects %j', (input) => {
    expect(parseNote(input)).toBeNull();
  });
});

// The two sets are the single source of truth for how an accidental may be
// spelled, so the cases come from them rather than from a copy.
describe('accidental spellings', () => {
  it.each([...SHARP_CHARS])('reads %j as a sharp', (char) => {
    expect(parseNote(`C${char}`)).toEqual(note('C', 1));
  });

  it.each([...FLAT_CHARS])('reads %j as a flat', (char) => {
    expect(parseNote(`C${char}`)).toEqual(note('C', -1));
  });
});

describe('readNotePrefix', () => {
  it('returns what follows the note', () => {
    expect(readNotePrefix('C#m7')).toEqual({ note: note('C', 1), rest: 'm7' });
    expect(readNotePrefix('Am/B')).toEqual({ note: note('A'), rest: 'm/B' });
  });

  it('takes accidentals greedily, so a flat is never left to the quality', () => {
    expect(readNotePrefix('Gbim')).toEqual({ note: note('G', -1), rest: 'im' });
  });

  it('returns null when the text does not start with a note', () => {
    expect(readNotePrefix('N.C.')).toBeNull();
  });
});
