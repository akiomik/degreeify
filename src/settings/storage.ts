import { browser } from 'wxt/browser';
import type { SpellingPolicy } from '@/core/degree';
import type { KeySource, Mode } from '@/core/key';
import type { Notation } from '@/core/notation';

/**
 * The settings, and the two things this extension keeps in storage.
 *
 * Everything reachable from a popup and a content script at once lives here,
 * because those two never speak to each other directly: one writes what it
 * found and the other reads it, and storage is the only thing they share.
 */

/**
 * The shape stored settings are in.
 *
 * Bumped when the shape changes, and checked on the way in. A version this
 * does not know is not read: it is replaced with the defaults, because
 * reading a shape from a version that does not exist yet means guessing which
 * fields moved, and a wrong guess is a reader's settings silently changed.
 */
export const SCHEMA_VERSION = 1;

/** A key a person set for a page, as it is kept. */
export interface KeyOverride {
  /** The tonic, spelled as `core` spells one: a letter and its accidentals. */
  readonly tonic: string;
  readonly mode: Mode;
  /**
   * When this was last used to name a chart, to the day.
   *
   * Kept so that the oldest can be dropped when there are too many. Written
   * no more than once a day per page, because the alternative is a storage
   * write on every chart anyone opens.
   */
  readonly usedAt: number;
}

export interface Settings {
  readonly version: number;
  /** Whether the page is rewritten. What is read off the page never depends on this. */
  readonly enabled: boolean;
  readonly notation: Notation;
  readonly spelling: SpellingPolicy;
  /**
   * A key per chart, keyed by what the site adapter calls the chart.
   *
   * Kept as the key at no transposition, and shifted by however far the
   * reader has transposed the chart when it is used. Kept the other way — as
   * the key of the chart as it stands — transposing would move the chart out
   * from under its own setting, and a reader would lose what they had set by
   * pressing a button that changes nothing about the song.
   */
  readonly keyOverrides: Readonly<Record<string, KeyOverride>>;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SCHEMA_VERSION,
  enabled: true,
  notation: 'roman-ascii',
  spelling: 'canonical',
  keyOverrides: {},
};

/** What a content script found on a page, for the popup to show. */
export interface Detection {
  /**
   * The shape this was written in, checked the way the settings are.
   *
   * A record is written by a content script and read by a popup, and an
   * extension is updated with pages already open: the two are not always the
   * same build. Without this a record from another shape is read as though it
   * were this one, and what a reader sees is a popup counting `undefined`
   * chords and hiding a control because `undefined <= 1` is false.
   */
  readonly version: number;
  /**
   * What the site adapter calls this chart, which is what a key set for it is
   * kept under.
   *
   * In the record rather than being the record's own key. It comes from the
   * page — a `<link rel="canonical">`, among others — and a popup has only
   * the address of the tab, which it cannot turn into this without asking the
   * page, which needs permissions this extension does without.
   */
  readonly pageId: string;
  /** The key the chart was read in, and where it came from. */
  readonly key: { readonly tonic: string; readonly mode: Mode } | null;
  readonly source: KeySource | null;
  /** How many keys the chart states, and how many of those could not be read. */
  readonly statedKeys: number;
  readonly unreadKeys: number;
  /** How far the reader has transposed the chart, where the page says. */
  readonly transposeOffset: number | null;
  readonly named: number;
  readonly updatedAt: number;
}

const SETTINGS_KEY = 'settings';
const DETECTION_PREFIX = 'detected:';

/**
 * The storage key for what was found at an address.
 *
 * The address without its fragment, on both sides. A popup reads `tab.url`
 * and a content script writes `location.href`, and a reader who follows an
 * anchor on the page leaves those two different — the record would be written
 * under one and looked for under the other, and the popup would show a chart
 * it could not find.
 *
 * Null where there is no address to speak of. A popup can be opened on any
 * tab, and a tab this extension has no permission for reports no address at
 * all; a null here is that ordinary case rather than an error.
 */
export function recordKey(address: string | undefined | null): string | null {
  if (!address) return null;

  try {
    const url = new URL(address);
    url.hash = '';
    return `${DETECTION_PREFIX}${url.href}`;
  } catch {
    return null;
  }
}

export async function loadSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];

  return isSettings(stored) ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Calls back whenever the settings change, and hands back a way to stop.
 *
 * A content script and a popup are two readers of one setting, and the page
 * has to follow the popup without being asked twice.
 */
export function watchSettings(onChange: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    area: string,
  ) => {
    if (area !== 'local') return;

    const change = changes[SETTINGS_KEY];
    if (!change) return;

    // A stamp moving is not a change anybody asked for. A page marks the key
    // it used as used today, and every page open on the site would otherwise
    // hear about it and read, restore, measure and rewrite itself over a
    // field nothing displays — a flicker on the tab that caused it, and the
    // same work again on every other one.
    if (onlyStampsMoved(change.oldValue, change.newValue)) return;

    onChange(
      isSettings(change.newValue) ? { ...DEFAULT_SETTINGS, ...change.newValue } : DEFAULT_SETTINGS,
    );
  };

  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

export async function readDetection(key: string): Promise<Detection | null> {
  const stored = (await browser.storage.local.get(key))[key];
  return isDetection(stored) ? stored : null;
}

/**
 * Calls back whenever what was found on this page changes.
 *
 * A popup opened before a content script has finished, or one whose reader
 * has just changed the key, is looking at a record that is about to be
 * replaced. Read once, the line the popup exists for would go on describing
 * the page as it was before the reader touched it — and would contradict the
 * control they had just used.
 */
export function watchDetection(key: string, onChange: (detection: Detection) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;

    const change = changes[key];
    if (change && isDetection(change.newValue)) onChange(change.newValue);
  };

  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

export async function writeDetection(key: string, detection: Detection): Promise<void> {
  await browser.storage.local.set({ [key]: detection });
}

/**
 * The most recent records, and nothing older.
 *
 * Done where a person opened something rather than on every page anyone
 * visits. A content script runs on every page and a popup runs when it is
 * asked for, so a sweep of every key in storage belongs in the popup: the
 * page a reader is on should not pay for the tidying of pages they left.
 */
export async function pruneDetections(most = MOST_DETECTIONS): Promise<void> {
  const all = await browser.storage.local.get(null);

  // Every record, and not only the ones this build can read. A record written
  // in another shape is one nothing will ever read again, and leaving it out
  // of the count leaves it in storage for good — a bump to the version would
  // otherwise strand every record ever written while a fresh fifty pile up
  // beside them.
  const records = Object.entries(all)
    .filter(([key]) => key.startsWith(DETECTION_PREFIX))
    .map(([key, value]) => ({ key, updatedAt: isDetection(value) ? value.updatedAt : 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const stale = records.slice(most).map((record) => record.key);
  if (stale.length > 0) await browser.storage.local.remove(stale);
}

/** How many pages this remembers reading, before the oldest are forgotten. */
export const MOST_DETECTIONS = 50;

/** How many charts a key can be kept for, before the least used are forgotten. */
export const MOST_OVERRIDES = 200;

/**
 * The overrides, with the least recently used dropped where there are too
 * many.
 *
 * A number rather than none, because a record kept for every chart anyone
 * ever opened grows without ever being read again.
 */
export function prunedOverrides(
  overrides: Readonly<Record<string, KeyOverride>>,
  most = MOST_OVERRIDES,
): Record<string, KeyOverride> {
  const kept = Object.entries(overrides)
    .sort(([, a], [, b]) => b.usedAt - a.usedAt)
    .slice(0, most);

  return Object.fromEntries(kept);
}

/** A day, which is how often a page's last-used stamp is worth rewriting. */
export const USED_AT_GRANULARITY = 24 * 60 * 60 * 1000;

/**
 * Whether two settings differ in nothing but when a key was last used.
 *
 * The stamps decide which keys are dropped when there are too many, so they
 * are part of the settings; they are not something a reader chose, and
 * nothing shows them.
 */
function onlyStampsMoved(before: unknown, after: unknown): boolean {
  if (!isSettings(before) || !isSettings(after)) return false;

  return JSON.stringify(withoutStamps(before)) === JSON.stringify(withoutStamps(after));
}

function withoutStamps(settings: Settings) {
  const keys = Object.entries(settings.keyOverrides).map(([page, { tonic, mode }]) => [
    page,
    { tonic, mode },
  ]);

  return { ...settings, keyOverrides: Object.fromEntries(keys) };
}

function isSettings(value: unknown): value is Settings {
  return isRecord(value) && value.version === SCHEMA_VERSION;
}

function isDetection(value: unknown): value is Detection {
  return isRecord(value) && value.version === SCHEMA_VERSION && typeof value.pageId === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
