import { describe, expect, it } from 'vitest';
import { parseChord } from '@/core/chord';
import { type Alteration, type Numeral, toDegreeChord } from '@/core/degree';
import type { Key, Mode } from '@/core/key';
import { formatDegree, formatDegreeChord, type Notation } from '@/core/notation';
import { parseNote } from '@/core/pitch';

const key = (tonic: string, mode: Mode = 'major'): Key => {
  const note = parseNote(tonic);
  if (!note) throw new Error(`${tonic} is not a note`);
  return { tonic: note, mode };
};

const nameOf = (chord: string, inKey: Key, notation?: Notation): string => {
  const parsed = parseChord(chord);
  if (!parsed) throw new Error(`expected ${chord} to parse as a chord`);
  return formatDegreeChord(toDegreeChord(parsed, inKey), notation);
};

const degree = (numeral: Numeral, alteration: Alteration) => ({ numeral, alteration });

describe('formatDegree', () => {
  const numerals: [Numeral, string, string][] = [
    [1, 'I', 'Ⅰ'],
    [2, 'II', 'Ⅱ'],
    [3, 'III', 'Ⅲ'],
    [4, 'IV', 'Ⅳ'],
    [5, 'V', 'Ⅴ'],
    [6, 'VI', 'Ⅵ'],
    [7, 'VII', 'Ⅶ'],
  ];

  it.each(numerals)('writes degree %i as %s in ascii', (numeral, ascii) => {
    expect(formatDegree(degree(numeral, 0))).toBe(ascii);
  });

  it.each(numerals)('writes degree %i as %s in unicode', (numeral, _ascii, unicode) => {
    expect(formatDegree(degree(numeral, 0), 'roman-unicode')).toBe(unicode);
  });

  it('marks an alteration with the accidental of its notation', () => {
    expect(formatDegree(degree(7, -1))).toBe('bVII');
    expect(formatDegree(degree(4, 1))).toBe('#IV');
    expect(formatDegree(degree(7, -1), 'roman-unicode')).toBe('♭Ⅶ');
    expect(formatDegree(degree(4, 1), 'roman-unicode')).toBe('♯Ⅳ');
  });

  it('defaults to ascii, which is the one certain to be measured per column', () => {
    expect(formatDegree(degree(6, 0))).toBe(formatDegree(degree(6, 0), 'roman-ascii'));
  });
});

describe('formatDegreeChord', () => {
  it('keeps the quality as the chart wrote it', () => {
    expect(nameOf('Am7', key('C'))).toBe('VIm7');
    expect(nameOf('CM7(#11)', key('C'))).toBe('IM7(#11)');
    expect(nameOf('Bm7-5', key('C'))).toBe('VIIm7-5');
  });

  it('writes a bass with a slash however the chart spelled it', () => {
    expect(nameOf('D#m/G#', key('C'))).toBe('bIIIm/bVI');
    expect(nameOf('ConE', key('C'))).toBe('I/III');
  });

  it('puts back the parentheses of an optional chord', () => {
    expect(nameOf('(Em7)', key('C'))).toBe('(IIIm7)');
    expect(nameOf('(Em7)', key('C'), 'roman-unicode')).toBe('(Ⅲm7)');
  });

  it('is shorter in unicode, which is the point of having it', () => {
    expect(nameOf('Bm7-5', key('C'))).toBe('VIIm7-5');
    expect(nameOf('Bm7-5', key('C'), 'roman-unicode')).toBe('Ⅶm7-5');
  });

  // A quality that starts with a roman numeral letter runs into the numeral
  // in front of it. Both of these are mistyped in the chart to begin with,
  // and nothing tells such a quality from a real one, so they are left to
  // read oddly rather than guessed at. Pinned so the behaviour is a decision
  // rather than an accident.
  describe('a quality that reads as part of the numeral', () => {
    it('leaves a mistyped Gbim reading as a second in ascii', () => {
      expect(nameOf('Gbim', key('F#'))).toBe('Iim');
      expect(nameOf('Gbim', key('F#'), 'roman-unicode')).toBe('Ⅰim');
    });

    it('leaves Cv reading as a fourth in ascii', () => {
      expect(nameOf('Cv', key('C'))).toBe('Iv');
      expect(nameOf('Cv', key('C'), 'roman-unicode')).toBe('Ⅰv');
    });
  });
});
