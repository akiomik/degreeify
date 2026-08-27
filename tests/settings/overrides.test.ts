import { describe, expect, it } from 'vitest';
import { formatKey, type Key, type Mode } from '@/core/key';
import { parseNote } from '@/core/pitch';
import { overrideFor, withOverride, withoutOverride } from '@/settings/overrides';
import { DEFAULT_SETTINGS, type Settings } from '@/settings/storage';

const key = (tonic: string, mode: Mode = 'major'): Key => {
  const note = parseNote(tonic);
  if (!note) throw new Error(`${tonic} is not a note`);
  return { tonic: note, mode };
};

const PAGE = 'chordwiki:chart:Test Song';

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
    const settings = withOverride(DEFAULT_SETTINGS, PAGE, key('Gb'), 6, {});

    expect(settings.keyOverrides[PAGE]).toEqual({ tonic: 'C', mode: 'major' });
  });

  // Which is the property the two directions exist for: what a reader sets is
  // what they are shown, whatever transposition they set it at.
  it.each([-5, -1, 0, 1, 6, 12])('comes back as it was set, at a transposition of %i', (offset) => {
    const settings = withOverride(DEFAULT_SETTINGS, PAGE, key('Eb', 'minor'), offset, {});

    expect(named(settings, offset)).toBe('Ebm');
  });

  it('replaces one already set for the same chart', () => {
    const first = withOverride(DEFAULT_SETTINGS, PAGE, key('C'), 0, {});
    const second = withOverride(first, PAGE, key('D'), 0, {});

    expect(Object.keys(second.keyOverrides)).toEqual([PAGE]);
    expect(named(second, 0)).toBe('D');
  });

  it('takes the chart back to its own key when it is removed', () => {
    const settings = withOverride(DEFAULT_SETTINGS, PAGE, key('C'), 0, {});

    expect(named(withoutOverride(settings, PAGE), 0)).toBeNull();
  });

  it('leaves other charts alone when one is removed', () => {
    const settings = withOverride(withKey('C'), 'chordwiki:chart:Other', key('D'), 0, {});

    expect(Object.keys(withoutOverride(settings, PAGE).keyOverrides)).toEqual([
      'chordwiki:chart:Other',
    ]);
  });
});
