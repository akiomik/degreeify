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

    // One end of the chart, against a fit that leaves nothing unaccounted
    // for, is the least evidence that still names a key.
    it('settles for opening on the tonic when every chord fits', () => {
      expect(guessOf('C', 'F', 'G', 'Am', 'Dm', 'Em')).toBe('C');
    });

    // A major key borrows a fifth from its relative minor's own scale as
    // readily as the minor key uses it, so it must not cost the major key
    // the chart. This is what a mode table holding chords its relative lacks
    // would get wrong, every time.
    it("keeps a major key that reaches for its relative minor's dominant", () => {
      expect(guessOf('C', 'Dm', 'Em', 'F', 'G', 'Am', 'E7', 'C')).toBe('C');
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

  // Every chord is read as it was written down, which means reading the
  // spellings a chart actually uses rather than one canonical form of each.
  describe('reading the chords', () => {
    it('takes a flattened fifth however the chart spells it', () => {
      const plain = inferKey(chords('C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C'));
      const spellings = ['Bm7-5', 'Bm7b5', 'Bm7(b5)', 'Bm7(♭5)', 'Bm7−5', 'Bm7(－5)'];

      for (const spelling of spellings) {
        const guess = inferKey(chords('C', 'Dm', 'Em', 'F', 'G', 'Am', spelling, 'C'));
        expect(guess?.confidence).toBe(plain?.confidence);
      }
    });

    // `7sus4` is as common as `sus4`, and neither states a third.
    it('finds no third in a suspension wherever it sits in the quality', () => {
      expect(guessOf('C7sus4', 'F7sus4', 'G7sus4', 'C7sus4')).toBeNull();
    });

    // Which chord opens and closes a chart is about its root alone, so a
    // chord whose triad cannot be read still counts at the ends.
    it('takes the ends of the chart from chords it cannot otherwise read', () => {
      expect(guessOf('Csus4', 'F', 'G', 'Am', 'Dm', 'C5')).toBe('C');
    });
  });

  // An augmented chord belongs to no key's plain scale, so it counts against
  // every candidate rather than being set aside. That costs confidence in
  // proportion to how chromatic the chart is, which is the right direction.
  describe('a chord in no key at all', () => {
    it('still names a key that carries one or two in passing', () => {
      expect(guessOf('C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'Caug', 'C')).toBe('C');
      expect(guessOf('C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'Caug', 'Faug', 'C')).toBe('C');
    });

    it('declines on a chart made mostly of them', () => {
      expect(guessOf('C', 'F', 'G', 'Am', 'Dm', 'Caug', 'Faug', 'Gaug', 'C')).toBeNull();
    });
  });

  describe('spelling the tonic', () => {
    it('follows the chart rather than a table', () => {
      expect(guessOf('F#', 'B', 'C#', 'D#m', 'F#')).toBe('F#');
    });

    it('follows the spelling the chart uses most, not the one it uses first', () => {
      expect(guessOf('Gb', 'B', 'C#', 'D#m', 'F#', 'F#', 'F#')).toBe('F#');
    });
  });

  describe('declining', () => {
    it('declines on too few different chords to tell keys apart', () => {
      expect(guessOf('C', 'G', 'C', 'G')).toBeNull();
    });

    // A key and its relative are built from the same chords and can never be
    // separated by fit alone. This chart opens and closes on neither tonic
    // and holds no chord that only one of the two modes has, so there is
    // nothing at all to choose between them.
    it('declines when nothing chooses between a key and its relative', () => {
      expect(guessOf('Dm', 'F', 'G', 'Am', 'Em', 'Dm')).toBeNull();
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
