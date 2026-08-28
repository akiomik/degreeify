import { type Key, transposeKey } from '@/core/key';
import { formatNote, parseNote } from '@/core/pitch';
import {
  type KeyOverride,
  type KeyStamps,
  MOST_OVERRIDES,
  prunedOverrides,
  type Settings,
} from './storage';

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

/** The settings and the stamps, which are written together or not at all. */
export interface Kept {
  readonly settings: Settings;
  readonly stamps: KeyStamps;
}

/**
 * `key` set for this chart, `key` being the key of the chart as it is shown.
 *
 * Kept shifted back to no transposition, so that the same setting is found
 * again whatever transposition the chart is next reached at. Kept as shown, a
 * reader who transposed a chart after setting a key would find their own
 * setting naming the page wrongly.
 *
 * Stamped as used now, and that is not bookkeeping: the stamps are what
 * decides which key is dropped when there are too many, and a key set a
 * moment ago has never been used. Left unstamped it sorts last, so a reader
 * with a full list would set a key, be told it was kept, and find it gone.
 */
export function withOverride(
  { settings, stamps }: Kept,
  pageId: string,
  key: Key,
  offset: number,
  now: number,
): Kept {
  const untransposed = transposeKey(key, -offset);

  return kept(
    settings,
    {
      ...settings.keyOverrides,
      [pageId]: { tonic: formatNote(untransposed.tonic), mode: untransposed.mode },
    },
    { ...stamps, [pageId]: now },
  );
}

export function withoutOverride({ settings, stamps }: Kept, pageId: string): Kept {
  const { [pageId]: _dropped, ...rest } = settings.keyOverrides;
  return kept(settings, rest, stamps);
}

/**
 * The two put back together, with nothing kept for a chart that has no key.
 *
 * A stamp outliving the key it was about is a record that grows and is never
 * read: overrides are capped and stamps were not, so a reader who set and
 * cleared keys across enough charts would carry every chart they had ever
 * touched, read in full on every write.
 */
function kept(settings: Settings, overrides: Record<string, KeyOverride>, stamps: KeyStamps): Kept {
  const surviving = prunedOverrides(overrides, stamps, MOST_OVERRIDES);
  const theirs = Object.keys(surviving).map((pageId) => [pageId, stamps[pageId] ?? 0] as const);

  return {
    settings: { ...settings, keyOverrides: surviving },
    stamps: Object.fromEntries(theirs),
  };
}
