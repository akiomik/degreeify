import { describe, expect, it } from 'vitest';
import { formatKey, type Key, type Mode } from '@/core/key';
import { parseNote } from '@/core/pitch';
import {
  type Kept,
  overrideFor,
  usableOffset,
  withOverride,
  withoutOverride,
} from '@/settings/overrides';
import { DEFAULT_SETTINGS, MOST_OVERRIDES, type Settings } from '@/settings/storage';

const key = (tonic: string, mode: Mode = 'major'): Key => {
  const note = parseNote(tonic);
  if (!note) throw new Error(`${tonic} is not a note`);
  return { tonic: note, mode };
};

const PAGE = 'chordwiki:chart:Test Song';

const EMPTY: Kept = { settings: DEFAULT_SETTINGS, stamps: {} };

const withKey = (tonic: string, mode: Mode = 'major'): Settings => ({
  ...DEFAULT_SETTINGS,
  keyOverrides: { [PAGE]: { tonic, mode } },
});

const named = (settings: Settings, offset: number | null): string | null => {
  const found = overrideFor(settings, PAGE, offset);
  return found && formatKey(found);
};

describe('a key set for a chart', () => {
  it('is the key it was set as where the chart has not been transposed', () => {
    expect(named(withKey('C'), 0)).toBe('C');
  });

  // A key is kept as the key of the untransposed chart, so that transposing
  // one does not move it out from under the setting a reader made. Which
  // means it has to be moved to where the chart is before it can name
  // anything.
  it('moves with the chart', () => {
    expect(named(withKey('C'), 6)).toBe('Gb');
    expect(named(withKey('C'), -5)).toBe('G');
    expect(named(withKey('A', 'minor'), 3)).toBe('Cm');
  });

  // A key meant for one transposition, applied at an unknown other, names
  // every chord on the page against the wrong tonic — and it would do so most
  // confidently on the pages where a reader had gone to the trouble.
  it('is not used where the page does not say how far the chart has moved', () => {
    expect(named(withKey('C'), null)).toBeNull();
  });

  // A key that cannot be read is no key. Storage is written by some version
  // of this extension or by somebody with the developer tools open, and a
  // throw here comes out of the popup's first read and takes the whole popup
  // with it — including the button that would let the reader be rid of what
  // caused it.
  it.each([
    ['a tonic that is no note', { tonic: 'H', mode: 'major' }],
    ['a tonic that is not text', { tonic: 5, mode: 'major' }],
    ['a mode that is no mode', { tonic: 'C', mode: 'dorian' }],
    ['nothing that is a key at all', 7],
  ])('is nothing for %s', (_what, stored) => {
    const settings = { ...DEFAULT_SETTINGS, keyOverrides: { [PAGE]: stored } } as Settings;

    expect(named(settings, 0)).toBeNull();
  });

  // A transposition that is not a count of semitones reaches the table by way
  // of arithmetic on it, finds no row, and throws — out of the popup's first
  // read, where it takes the whole popup with it.
  it.each([Number.NaN, 1.5, Number.POSITIVE_INFINITY])(
    'is nothing where the page says it has moved by %s',
    (offset) => {
      expect(named(withKey('C'), offset)).toBeNull();
    },
  );

  // The same question the control that offers to set a key is asked, so that
  // it cannot offer to keep something the page will then refuse.
  it.each([0, 6, -5])('is a transposition of %i semitones a page can keep a key at', (offset) => {
    expect(usableOffset(offset)).toBe(true);
  });

  it.each([null, undefined, Number.NaN, 1.5, '3'])('is %s not one', (offset) => {
    expect(usableOffset(offset as never)).toBe(false);
  });

  it('is nothing where none was set', () => {
    expect(named(DEFAULT_SETTINGS, 0)).toBeNull();
  });
});

describe('setting a key from what is on the screen', () => {
  // A reader sets the key of the chart in front of them, and it is kept as
  // the key of the chart untransposed. Kept as shown, transposing the chart
  // afterwards would leave their own setting naming the page wrongly.
  it('keeps it shifted back to where the chart started', () => {
    const { settings } = withOverride(EMPTY, PAGE, key('Gb'), 6, 1);

    expect(settings.keyOverrides[PAGE]).toEqual({ tonic: 'C', mode: 'major' });
  });

  // Which is the property the two directions exist for: what a reader sets is
  // what they are shown, whatever transposition they set it at.
  it.each([-5, -1, 0, 1, 6, 12])('comes back as it was set, at a transposition of %i', (offset) => {
    const { settings } = withOverride(EMPTY, PAGE, key('Eb', 'minor'), offset, 1);

    expect(named(settings, offset)).toBe('Ebm');
  });

  it('replaces one already set for the same chart', () => {
    const first = withOverride(EMPTY, PAGE, key('C'), 0, 1);
    const second = withOverride(first, PAGE, key('D'), 0, 2);

    expect(Object.keys(second.settings.keyOverrides)).toEqual([PAGE]);
    expect(named(second.settings, 0)).toBe('D');
  });

  it('takes the chart back to its own key when it is removed', () => {
    const set = withOverride(EMPTY, PAGE, key('C'), 0, 1);

    expect(named(withoutOverride(set, PAGE).settings, 0)).toBeNull();
  });

  it('leaves other charts alone when one is removed', () => {
    const both = withOverride(
      { settings: withKey('C'), stamps: { [PAGE]: 1 } },
      'chordwiki:chart:Other',
      key('D'),
      0,
      2,
    );

    expect(Object.keys(withoutOverride(both, PAGE).settings.keyOverrides)).toEqual([
      'chordwiki:chart:Other',
    ]);
  });

  // A key set a moment ago has never been used, so it sorts last among a full
  // list — and a reader would be told it was kept and find it gone. Stamping
  // it as it is set is what keeps the newest thing from being the first thing
  // dropped.
  it('keeps a key set when the list is already full', () => {
    const full = Object.fromEntries(
      Array.from({ length: MOST_OVERRIDES }, (_, index) => [
        `page-${index}`,
        { tonic: 'C', mode: 'major' as const },
      ]),
    );
    const stamps = Object.fromEntries(Object.keys(full).map((page, index) => [page, index + 1]));

    const kept = withOverride(
      { settings: { ...DEFAULT_SETTINGS, keyOverrides: full }, stamps },
      PAGE,
      key('D'),
      0,
      1000,
    );

    expect(kept.settings.keyOverrides[PAGE]).toEqual({ tonic: 'D', mode: 'major' });
    expect(Object.keys(kept.settings.keyOverrides)).toHaveLength(MOST_OVERRIDES);
  });

  // A stamp outliving the key it was about is a record that grows and is
  // never read.
  it('forgets when a key was used once the key is gone', () => {
    const set = withOverride(EMPTY, PAGE, key('C'), 0, 1);

    expect(withoutOverride(set, PAGE).stamps).toEqual({});
  });

  // And a key with no stamp is left without one rather than given a nought.
  // The write that follows sends every stamp that differs from what was read,
  // and a nought differs from nothing at all — so a page stamping a chart for
  // the first time, while a reader changed something else, would have that
  // stamp written back to nought.
  it('does not invent a stamp for a key that has none', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      keyOverrides: {
        [PAGE]: { tonic: 'C', mode: 'major' },
        other: { tonic: 'D', mode: 'major' },
      },
    };

    const left = withoutOverride({ settings, stamps: { [PAGE]: 1 } }, PAGE);

    expect(left.settings.keyOverrides).toEqual({ other: { tonic: 'D', mode: 'major' } });
    expect(left.stamps).toEqual({});
  });
});
