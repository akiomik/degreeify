import { describe, expect, it } from 'vitest';
import { parseChord } from '@/core/chord';
import { type SpellingPolicy, toDegree, toDegreeChord } from '@/core/degree';
import type { Key, Mode } from '@/core/key';
import { formatDegree, formatDegreeChord } from '@/core/notation';
import { parseNote } from '@/core/pitch';

const key = (tonic: string, mode: Mode = 'major'): Key => {
  const note = parseNote(tonic);
  if (!note) throw new Error(`${tonic} is not a note`);
  return { tonic: note, mode };
};

/** The degree name a chart would show for `chord`, which is what these tables state. */
const nameOf = (chord: string, inKey: Key, policy?: SpellingPolicy): string => {
  const parsed = parseChord(chord);
  if (!parsed) throw new Error(`expected ${chord} to parse as a chord`);
  return formatDegreeChord(toDegreeChord(parsed, inKey, policy));
};

describe('toDegreeChord', () => {
  // Both policies, side by side. Of the fifteen, only `Gb` and `D#dim` differ,
  // and those two are exactly where the choice of policy shows up.
  describe('in C major', () => {
    const cases: [chord: string, canonical: string, source: string][] = [
      ['C', 'I', 'I'],
      ['Dm7', 'IIm7', 'IIm7'],
      ['Em7', 'IIIm7', 'IIIm7'],
      ['F', 'IV', 'IV'],
      ['G7', 'V7', 'V7'],
      ['Am', 'VIm', 'VIm'],
      ['Bm7-5', 'VIIm7-5', 'VIIm7-5'],
      ['E7', 'III7', 'III7'],
      ['Bb', 'bVII', 'bVII'],
      ['Ab', 'bVI', 'bVI'],
      ['F#m7-5', '#IVm7-5', '#IVm7-5'],
      ['Gb', '#IV', 'bV'],
      ['D#dim', 'bIIIdim', '#IIdim'],
      ['C/E', 'I/III', 'I/III'],
      ['ConE', 'I/III', 'I/III'],
    ];

    it.each(cases)('names %s as %s by default', (chord, canonical) => {
      expect(nameOf(chord, key('C'))).toBe(canonical);
    });

    it.each(cases)('names %s as %s under the source policy', (chord, _canonical, source) => {
      expect(nameOf(chord, key('C'), 'source')).toBe(source);
    });
  });

  // A minor key needs no separate code path: degrees are measured from the
  // tonic's major scale whatever the mode. Both policies agree throughout.
  describe('in A minor', () => {
    const cases: [chord: string, name: string][] = [
      ['Am', 'Im'],
      ['Bm7-5', 'IIm7-5'],
      ['C', 'bIII'],
      ['Dm', 'IVm'],
      ['E7', 'V7'],
      ['F', 'bVI'],
      ['G', 'bVII'],
    ];

    it.each(cases)('names %s as %s under either policy', (chord, name) => {
      expect(nameOf(chord, key('A', 'minor'))).toBe(name);
      expect(nameOf(chord, key('A', 'minor'), 'source')).toBe(name);
    });
  });

  // Five of the twelve pitches have two conventional spellings. The canonical
  // policy settles all five, four of them onto the flat and the tritone onto
  // the sharp, which is the whole of the difference between the policies.
  describe('the pitches that have two spellings', () => {
    const cases: [semitones: number, chord: string, canonical: string, source: string][] = [
      [1, 'C#', 'bII', '#I'],
      [3, 'D#', 'bIII', '#II'],
      // Also the case that catches an alteration measured without wrapping
      // into the negative: `Gb` against C comes out a semitone flat of the
      // fifth, not eleven semitones sharp of the first.
      [6, 'Gb', '#IV', 'bV'],
      [8, 'G#', 'bVI', '#V'],
      [10, 'A#', 'bVII', '#VI'],
    ];

    it.each(cases)(
      'spells %i semitones up as %s, or %s from the source',
      (_semitones, chord, canonical, source) => {
        expect(nameOf(chord, key('C'))).toBe(canonical);
        expect(nameOf(chord, key('C'), 'source')).toBe(source);
      },
    );
  });

  describe('spellings nobody writes', () => {
    // The chart spells this a first flat below the tonic and a second double
    // flat. Neither is a degree name in use, so both fall back to the pitch's
    // default spelling rather than being carried through.
    const cases: [chord: string, inKey: string, name: string][] = [
      ['Faug/D#', 'F#', 'VIIaug/VI'],
      ['Gb', 'F#', 'I'],
    ];

    it.each(cases)('falls back rather than spelling %s in %s as written', (chord, tonic, name) => {
      expect(nameOf(chord, key(tonic))).toBe(name);
      expect(nameOf(chord, key(tonic), 'source')).toBe(name);
    });
  });

  // The site transposes a chart by rewriting every chord, and it does not
  // choose enharmonic spellings by function when it does. The canonical
  // policy is unmoved by that; the source policy follows it. The full check
  // against the site's own output comes with the site adapter.
  describe('transposition', () => {
    const pairs: [original: string, transposed: string, canonical: string, source: string][] = [
      ['D', 'G#', 'bVI', '#V'],
      ['Gaug', 'C#aug', 'bIIaug', '#Iaug'],
      ['Am/B', 'D#m/F', 'bIIIm/IV', '#IIm/IV'],
    ];

    it.each(pairs)('names %s in F# and %s in C alike', (original, transposed, canonical) => {
      expect(nameOf(original, key('F#'))).toBe(canonical);
      expect(nameOf(transposed, key('C'))).toBe(canonical);
    });

    it.each(pairs)(
      'lets the source spelling of %s and %s drift apart',
      (original, transposed, canonical, source) => {
        expect(nameOf(original, key('F#'), 'source')).toBe(canonical);
        expect(nameOf(transposed, key('C'), 'source')).toBe(source);
      },
    );
  });
});

describe('toDegree', () => {
  it('measures from the tonic, whatever the mode says', () => {
    const inMajor = toDegree(key('C').tonic, key('A'));
    const inMinor = toDegree(key('C').tonic, key('A', 'minor'));
    expect(inMajor).toEqual(inMinor);
    expect(formatDegree(inMajor)).toBe('bIII');
  });

  it('names the tonic itself the first degree', () => {
    expect(formatDegree(toDegree(key('F#').tonic, key('F#')))).toBe('I');
  });
});
