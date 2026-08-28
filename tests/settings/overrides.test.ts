import { describe, expect, it } from 'vitest';
import { formatKey, type Key, type Mode } from '@/core/key';
import { parseNote } from '@/core/pitch';
import { type Kept, overrideFor, withOverride, withoutOverride } from '@/settings/overrides';
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

  it('is nothing where none was set, and nothing where it cannot be read', () => {
    expect(named(DEFAULT_SETTINGS, 0)).toBeNull();
    expect(named(withKey('H'), 0)).toBeNull();
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
});
