import { describe, expect, it } from 'vitest';
import { type ChordSymbol, parseChord } from '@/core/chord';
import { formatKey, inferKey, MIN_CONFIDENCE, parseKey } from '@/core/key';

const chords = (...symbols: string[]): ChordSymbol[] =>
  symbols.map((symbol) => {
    const chord = parseChord(symbol);
    if (!chord) throw new Error(`expected ${symbol} to parse as a chord`);
    return chord;
  });

/** The key inferred from a progression, or null where the guess is declined. */
const guessOf = (...symbols: string[]): string | null => {
  const guess = inferKey(chords(...symbols));
  return guess && formatKey(guess.key);
};

describe('parseKey', () => {
  const accepted: [string, string][] = [
    ['C', 'C'],
    ['F#', 'F#'],
    ['Bb', 'Bb'],
    ['Gm', 'Gm'],
    ['C#m', 'C#m'],
    ['  Am  ', 'Am'],
  ];

  it.each(accepted)('reads %j', (input, expected) => {
    const key = parseKey(input);
    expect(key && formatKey(key)).toBe(expected);
  });

  const rejected = ['', 'H', 'c', 'Cmaj', 'Cm7', 'C minor', 'Key: C'];

  it.each(rejected)('rejects %j', (input) => {
    expect(parseKey(input)).toBeNull();
  });

  it('reads the m as the mode rather than as a chord quality', () => {
    expect(parseKey('Gm')?.mode).toBe('minor');
    expect(parseKey('G')?.mode).toBe('major');
  });
});

describe('inferKey', () => {
  describe('when the chart says which key it is in', () => {
    it('reads a major key off its own chords', () => {
      expect(guessOf('C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C')).toBe('C');
    });

    it('reads a minor key off its own chords', () => {
      expect(guessOf('Am', 'Bm7-5', 'C', 'Dm', 'E7', 'F', 'G', 'Am')).toBe('Am');
    });

    it('needs only three chords when they point one way', () => {
      expect(guessOf('C', 'F', 'G', 'C')).toBe('C');
    });

    it('reports a confidence at or above the threshold it accepted on', () => {
      const guess = inferKey(chords('C', 'F', 'G', 'C'));
      expect(guess?.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
      expect(guess?.confidence).toBeLessThanOrEqual(1);
    });
  });

  // A minor key borrows its dominant from the harmonic minor far too often
  // for the natural minor alone to recognise one.
  describe('a minor key with a major fifth', () => {
    it('prefers the minor key over its relative major', () => {
      expect(guessOf('Am', 'Dm', 'E7', 'Am')).toBe('Am');
    });
  });

  describe('spelling the tonic', () => {
    it('follows the chart rather than a table', () => {
      expect(guessOf('F#', 'B', 'C#', 'D#m', 'F#')).toBe('F#');
    });
  });

  describe('declining', () => {
    it('declines on too few different chords to tell keys apart', () => {
      expect(guessOf('C', 'G', 'C', 'G')).toBeNull();
    });

    // A key and its relative are built from the same chords and can never be
    // separated by the chords alone. Opening and closing the chart is the
    // only evidence for one tonic over the other, and here it points at both.
    it('declines when nothing chooses between a key and its relative', () => {
      expect(guessOf('C', 'F', 'G', 'Am', 'Dm', 'Em')).toBeNull();
    });

    // The five different chords of a real chart that states no key. Two keys
    // account for four of them each and neither is the other's relative, so
    // there is no reading of this chart that settles it.
    it('declines on a chart that genuinely does not say', () => {
      expect(guessOf('DbM7', 'Cm7', 'Bbm', 'Eb', 'B')).toBeNull();
    });

    it('declines rather than picking one of the keys a modulating chart passes through', () => {
      const modulating = ['Gm', 'Cm7', 'D7', 'Gm', 'Em', 'Am7', 'B7', 'Em', 'Bm7', 'F#m7'];
      expect(guessOf(...modulating)).toBeNull();
    });

    it('has nothing to go on when no chord states a third', () => {
      expect(guessOf('C5', 'F5', 'G5', 'D5')).toBeNull();
    });

    it('has nothing to go on when it cannot read any of the qualities', () => {
      expect(guessOf('Cim', 'Fim', 'Gim')).toBeNull();
    });
  });
});
