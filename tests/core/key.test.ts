import { describe, expect, it } from 'vitest';
import {
  type ChordSymbol,
  DASH_LOOKALIKES,
  DASH_MARKS,
  PLUS_MARKS,
  parseChord,
  TRIANGLE_MARKS,
} from '@/core/chord';
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
    // for, is the least evidence that still names a key — and it lands
    // exactly on the threshold, which is what the threshold is defined as.
    // Pinned because a great many ordinary charts sit on this line, and
    // whether they are named at all turns on the comparison being strict.
    it('settles for opening on the tonic when every chord fits', () => {
      const guess = inferKey(chords('C', 'F', 'G', 'Am', 'Dm', 'Em'));
      expect(guess?.confidence).toBe(MIN_CONFIDENCE);
      expect(guess && formatKey(guess.key)).toBe('C');
    });

    // A major key borrows a fifth from its relative minor's own scale as
    // readily as the minor key uses it, so it must not cost the major key
    // the chart. This is what a mode table holding chords its relative lacks
    // would get wrong, every time.
    it("keeps a major key that reaches for its relative minor's dominant", () => {
      expect(guessOf('C', 'Dm', 'Em', 'F', 'G', 'Am', 'E7', 'C')).toBe('C');
    });

    // C major and C minor share almost none of their chords, but a tonic
    // chord with no third in it hands both of them the ends of the chart, so
    // the two can end up leading together. They disagree only about the mode,
    // and no degree name is drawn from the mode, so whichever of them is
    // taken the chart reads the same. Declining over that gives up an answer
    // for a difference that makes none.
    it('does not treat a key on the same tonic as a rival', () => {
      expect(guessOf('C5', 'Dm', 'Fm', 'G', 'Bdim', 'C5')).toBe('C');
    });

    it('reports a confidence at or above the threshold it accepted on', () => {
      const guess = inferKey(chords('C', 'F', 'G', 'C'));
      expect(guess?.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
      expect(guess?.confidence).toBeLessThanOrEqual(1);
    });
  });

  // A minor key borrows its dominant from the harmonic minor far too often
  // for the natural minor alone to recognise one.
  describe('a minor key that raises its seventh', () => {
    it('prefers the minor key over its relative major', () => {
      expect(guessOf('Am', 'Dm', 'E7', 'Am')).toBe('Am');
    });

    // The chords it raises the seventh for are the minor key's own. A minor
    // key that failed to explain them would drag its own fit down and hand
    // the chart to the parallel major, where the very same chords are plain
    // scale — on a chart that could hardly be more clearly minor.
    it('accounts for them rather than letting them count against it', () => {
      expect(guessOf('Am', 'Dm', 'E7', 'G#dim', 'Am')).toBe('Am');
    });

    // Each of them is worth the same. Crediting the mode once however many it
    // finds, while every one still takes up a slot of the fit, makes a chart
    // worse evidence for its own key the more of them it holds — and this
    // one, which is two thirds raised sevenths, would be given up on.
    it('counts every one of them, not just the first', () => {
      expect(guessOf('Am', 'E7', 'G#dim', 'Am')).toBe('Am');
    });

    // The parallel major has the same tonic and, on a chart resting there,
    // the same points for it. What settles them is that the minor key
    // accounts for the raised sevenths as its own while the major key can
    // make nothing of the plain ones — and, where even that comes out level,
    // that the chart spells its tonic chord minor.
    it('does not hand the chart to the parallel major', () => {
      expect(guessOf('Am', 'Dm', 'E7', 'G#dim', 'Am')).not.toBe('A');
      expect(guessOf('Am', 'E7', 'G#dim', 'Am')).toBe('Am');
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

    // A jazz lead sheet writes with a dash what a chart elsewhere writes with
    // an `m`, and the parser accepts every spelling of a dash.
    it.each([...DASH_MARKS])('reads %j as a minor third', (dash) => {
      expect(guessOf(`C${dash}7`, `F${dash}7`, `G${dash}7`, `C${dash}7`)).toBe('Cm');
    });

    // A quality is allowed to hold what a Japanese keyboard puts where a dash
    // would go, which is not the same as that character saying something on
    // its own. It reads as a dash where what surrounds it says so, and says
    // nothing at the front of a quality, where nothing does.
    it.each([...DASH_LOOKALIKES])('does not take %j at the front for a minor third', (mark) => {
      expect(guessOf(`C${mark}7`, `F${mark}7`, `G${mark}7`, `C${mark}7`)).toBeNull();
    });

    // Case matters for `M` against `m` and nowhere else, a flattened fifth
    // included: `m7B5` has to read the same as `m7b5`.
    it.each(['b5', 'B5', '-5', '♭5'])('reads a fifth flattened with %j', (flat) => {
      const plain = inferKey(chords('C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C'));
      const guess = inferKey(chords('C', 'Dm', 'Em', 'F', 'G', 'Am', `Bm7${flat}`, 'C'));
      expect(guess?.confidence).toBe(plain?.confidence);
    });

    // Everything a quality may hold where a dash would go reads as one here,
    // the look-alikes included: what surrounds it says what it is standing
    // for.
    it.each([...DASH_MARKS, ...DASH_LOOKALIKES])('reads a fifth flattened with %j', (dash) => {
      const plain = inferKey(chords('C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C'));
      const guess = inferKey(chords('C', 'Dm', 'Em', 'F', 'G', 'Am', `Bm7${dash}5`, 'C'));
      expect(guess?.confidence).toBe(plain?.confidence);
    });

    // Case says which of `M` and `m` is meant and nothing else, so a quality
    // spelled out as a word has to read the same however it is capitalised.
    // A suspension read as a major chord is the opposite of what it says.
    const capitalised: [string, string[], string | null][] = [
      ['a suspension', ['C7SUS4', 'F7SUS4', 'G7SUS4', 'C7SUS4'], null],
      ['a minor', ['CMI7', 'FMI7', 'GMI7', 'CMI7'], 'Cm'],
      ['a spelled-out minor', ['CMin7', 'FMin7', 'GMin7', 'CMin7'], 'Cm'],
      ['a major seventh', ['CMAJ7', 'Dm7', 'FMAJ7', 'G7', 'CMAJ7'], 'C'],
      ['a diminished', ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'BDIM', 'C'], 'C'],
    ];

    it.each(capitalised)('reads %s written in capitals', (_what, symbols, expected) => {
      expect(guessOf(...symbols)).toBe(expected);
    });

    // A quality that opens with a bracket says nothing before it, so the
    // triad is the plain one the root names.
    it('reads a bare triad under a parenthesised extension', () => {
      expect(guessOf('C(9)', 'F(9)', 'G(9)', 'C(9)')).toBe('C');
    });

    // The parser accepts every spelling of the triangle, so every spelling
    // has to mean a major third here. Driven off the parser's own list so the
    // two cannot drift apart.
    it.each([...TRIANGLE_MARKS])('reads %j as a major seventh', (mark) => {
      expect(guessOf(`C${mark}7`, 'Dm7', `F${mark}7`, 'G7', `C${mark}7`)).toBe('C');
    });

    // A fake book abbreviates a major seventh to `ma7`, which begins the way
    // both the minor spellings do and has to be settled before them.
    it.each(['maj7', 'ma7', 'MA7', 'Maj7'])('reads %j as a major seventh', (quality) => {
      expect(guessOf(`C${quality}`, 'Dm7', `F${quality}`, 'G7', `C${quality}`)).toBe('C');
    });

    // A minor chord with an added ninth opens `ma` without any of it being
    // the `ma` that says major.
    it.each(['madd9', 'madd11'])('reads %j as a minor chord', (quality) => {
      expect(guessOf(`C${quality}`, `F${quality}`, `G${quality}`, `C${quality}`)).toBe('Cm');
    });

    it('still reads the same addition on a major chord as major', () => {
      expect(guessOf('CMadd9', 'F', 'G', 'CMadd9')).toBe('C');
      expect(guessOf('Cadd9', 'F', 'G', 'Cadd9')).toBe('C');
    });

    // Which of the two it is comes down to the case of one letter, so a
    // quality shouted in capitals is not evidence for either.
    it('has nothing to say about an addition written in capitals', () => {
      expect(guessOf('CMADD9', 'FMADD9', 'GMADD9', 'CMADD9')).toBeNull();
    });

    // A raised fifth makes an augmented triad whatever else the quality says,
    // and a lowered one under a major third makes nothing that has a name.
    // Neither is the plain major triad they were being read as.
    describe('an altered fifth', () => {
      // A word naming the triad says so wherever it sits: `7aug` is `aug7`.
      it.each(['aug', 'aug7', '7aug'])('reads %j as augmented', (quality) => {
        expect(guessOf(`C${quality}`, `F${quality}`, `G${quality}`, `C${quality}`)).toBeNull();
      });

      it.each(['(#5)', '7#5', 'M7#5', '7(#5)'])('reads %j as augmented', (quality) => {
        expect(guessOf(`C${quality}`, `F${quality}`, `G${quality}`, `C${quality}`)).toBeNull();
      });

      it.each(['(b5)', '7-5', '7b5'])('has nothing to say about %j', (quality) => {
        expect(guessOf(`C${quality}`, `F${quality}`, `G${quality}`, `C${quality}`)).toBeNull();
      });

      // A third and a fifth go together four ways, and the two that have no
      // name have to be treated alike. Reading the raised fifth only under a
      // major third leaves `m7#5` a plain minor chord while `M7#5` is
      // augmented — the same mark taken two ways.
      it.each(['m#5', 'm7#5', 'mi7#5', 'm7+5'])('has nothing to say about %j either', (quality) => {
        expect(guessOf(`C${quality}`, `F${quality}`, `G${quality}`, `C${quality}`)).toBeNull();
      });

      // The two that do have a name keep it.
      it('still reads a lowered fifth under a minor third as diminished', () => {
        const plain = inferKey(chords('C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C'));
        const guess = inferKey(chords('C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bm7-5', 'C'));
        expect(guess?.confidence).toBe(plain?.confidence);
      });

      // A fake book raises and lowers with a pair of marks, and a chart using
      // one of them uses the other. Handling the dash but not the plus would
      // read half such a chart as plain major triads.
      it.each([...PLUS_MARKS])('reads a fifth raised with %j as augmented', (plus) => {
        expect(guessOf(`C7${plus}5`, `F7${plus}5`, `G7${plus}5`, `C7${plus}5`)).toBeNull();
      });

      // A plus with nothing after it is the raised fifth on its own, wherever
      // in the quality it sits. Against a number it raises that number, and
      // says nothing about the fifth.
      it.each([...PLUS_MARKS])('reads %j on its own as augmented', (plus) => {
        for (const quality of [plus, `${plus}7`, `7${plus}`]) {
          expect(guessOf(`C${quality}`, `F${quality}`, `G${quality}`, `C${quality}`)).toBeNull();
        }
      });

      it.each([...PLUS_MARKS])('leaves a ninth raised with %j a major chord', (plus) => {
        expect(guessOf(`C7${plus}9`, 'Dm7', `F7${plus}9`, 'G7', `C7${plus}9`)).toBe('C');
      });

      // The five is what the mark has to be against. An altered eleventh is
      // not an altered fifth.
      it('leaves an altered eleventh alone', () => {
        expect(guessOf('CM7(#11)', 'Dm7', 'FM7(#11)', 'G7', 'CM7(#11)')).toBe('C');
      });
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

  // Coming to rest on the tonic is what the ends of a chart say, and a chart
  // can rest on an altered tonic chord as readily as on the plain one.
  // Requiring the triad to agree gives those endings nothing, while the very
  // same chord still counts towards a rival key's chords.
  describe('an ending on an altered tonic chord', () => {
    it('still counts for a major key that finishes on a raised fifth', () => {
      expect(guessOf('C', 'F', 'G', 'Caug')).toBe('C');
    });

    it('still counts for a minor key that finishes on a major tonic', () => {
      expect(guessOf('Am', 'Dm', 'E7', 'A')).toBe('Am');
      expect(guessOf('Am', 'Dm', 'E7', 'F', 'G', 'Am', 'A')).toBe('Am');
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
    // separated by fit alone. Here C major and A minor account for all six
    // and neither end of the chart is on either tonic, so nothing at all
    // chooses between them — and D minor, which does hold both ends, cannot
    // account for enough of the chords to pull ahead of either. Three keys
    // level, and no reading of the chart settles it.
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
