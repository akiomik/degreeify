import { type Key, transposeKey } from '@/core/key';
import { formatNote, parseNote } from '@/core/pitch';
import { type KeyStamps, MOST_OVERRIDES, prunedOverrides, type Settings } from './storage';

/**
 * Reading and writing the key a person set for a chart.
 *
 * A key is kept as the key of the chart untransposed, and a reader sets and
 * sees the key of the chart in front of them. So every crossing between the
 * two shifts by however far the chart has been transposed, and both
 * directions are here rather than one in the popup and one in the content
 * script — the day they disagree, a reader sets a key and the page shows
 * another.
 */

/**
 * The key set for this chart, as the chart now stands.
 *
 * Nothing where the page does not say how far it has been transposed. A key
 * meant for one transposition, applied at an unknown other, names every chord
 * on the page against the wrong tonic — and it would do so most confidently
 * on the pages where a reader had gone to the trouble of setting one.
 */
export function overrideFor(settings: Settings, pageId: string, offset: number | null): Key | null {
  const stored = settings.keyOverrides[pageId];
  if (!stored || offset === null) return null;

  const tonic = parseNote(stored.tonic);
  return tonic ? transposeKey({ tonic, mode: stored.mode }, offset) : null;
}

/**
 * The settings with `key` set for this chart, `key` being the key of the
 * chart as it is being shown.
 *
 * Kept shifted back to no transposition, so that the same setting is found
 * again whatever transposition the chart is next reached at. Kept as shown,
 * a reader who transposed a chart after setting a key would find their own
 * setting naming the page wrongly.
 */
export function withOverride(
  settings: Settings,
  pageId: string,
  key: Key,
  offset: number,
  stamps: KeyStamps,
): Settings {
  const untransposed = transposeKey(key, -offset);

  return {
    ...settings,
    keyOverrides: prunedOverrides(
      {
        ...settings.keyOverrides,
        [pageId]: { tonic: formatNote(untransposed.tonic), mode: untransposed.mode },
      },
      stamps,
      MOST_OVERRIDES,
    ),
  };
}

export function withoutOverride(settings: Settings, pageId: string): Settings {
  const { [pageId]: _dropped, ...rest } = settings.keyOverrides;
  return { ...settings, keyOverrides: rest };
}
