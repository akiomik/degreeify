import { describe, expect, it } from 'vitest';
import { parseChord } from '@/core/chord';
import { type SpellingPolicy, toDegreeChord } from '@/core/degree';
import { type Key, parseKey } from '@/core/key';
import { formatDegreeChord } from '@/core/notation';
import { TRANSPOSITION_SAMPLES } from '../fixtures/transposition-pairs';

const keyNamed = (name: string): Key => {
  const key = parseKey(name);
  if (!key) throw new Error(`${name} is not a key`);
  return key;
};

/** What a chord slot would be shown as, which for anything but a chord is itself. */
const nameOf = (symbol: string, key: Key, policy?: SpellingPolicy): string => {
  const chord = parseChord(symbol);
  return chord ? formatDegreeChord(toDegreeChord(chord, key, policy)) : symbol;
};

/**
 * The same music, named twice.
 *
 * Transposing a chart rewrites every chord in it, so the site hands over the
 * same music under two keys — and a degree name is meant to be what does not
 * change between them. Anything that comes out differently is wrong one of
 * those two times, and nothing else available says so as plainly: this is the
 * site's own output, from a transposer with no idea anyone would line the two
 * up against each other.
 */
describe.each(TRANSPOSITION_SAMPLES)('$label', ({ from, to, pairs }) => {
  const written = keyNamed(from);
  const transposed = keyNamed(to);

  it.each(pairs)('names %s in the written key as it names %s in the transposed one', (a, b) => {
    expect(nameOf(b, transposed)).toBe(nameOf(a, written));
  });

  // Which is the point of the default policy. Deferring to the chart's own
  // spelling cannot promise this, because the spellings being deferred to are
  // whatever the transposer happened to write.
  it('names every pair alike', () => {
    const differing = pairs.filter(([a, b]) => nameOf(a, written) !== nameOf(b, transposed));
    expect(differing).toEqual([]);
  });

  // A bar line, an accent, a rhythm note: the site transposes a chart by
  // rewriting the chords in it, and these come through both sides untouched
  // because they were never chords.
  it('leaves what is not a chord as it found it', () => {
    const passed = pairs.filter(([a]) => parseChord(a) === null);

    for (const [a, b] of passed) {
      expect(a).toBe(b);
      expect(nameOf(a, written)).toBe(a);
      expect(nameOf(b, transposed)).toBe(b);
    }
  });
});

/**
 * The other policy makes no such promise, and it is worth showing rather than
 * asserting. Where the chart spells the same sound two ways under two keys —
 * and the transposer does, it is not choosing spellings by what they mean —
 * following it names the same music two ways.
 */
describe('keeping the chartspelling instead', () => {
  it('does not hold across a transposition', () => {
    const differing = TRANSPOSITION_SAMPLES.flatMap(({ from, to, pairs }) =>
      pairs.filter(
        ([a, b]) => nameOf(a, keyNamed(from), 'source') !== nameOf(b, keyNamed(to), 'source'),
      ),
    );

    expect(differing).toEqual([
      ['Am/B', 'D#m/F'],
      ['Baug/A', 'Faug/D#'],
      ['D', 'G#'],
      ['Gaug', 'C#aug'],
    ]);
  });
});
