import { browser } from 'wxt/browser';
import { SPELLING_POLICIES, type SpellingPolicy } from '@/core/degree';
import type { KeySource, Mode } from '@/core/key';
import { NOTATIONS, type Notation } from '@/core/notation';

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
 *
 * What a field may hold is part of that shape. Adding a third notation looks
 * like a change to one field's values and is a change of shape all the same:
 * an older build reads the new value, cannot use it, falls back to its own —
 * and writes that fallback back over the reader's choice on their first
 * unrelated click, because what is written is the whole object. Moving the
 * version is what stops that: the older build then refuses to write at all
 * and says why.
 *
 * Refusing runs one way. A version this build has never heard of is a build
 * from the future and is left alone; a version this build has grown out of is
 * read as the defaults and then written over on the reader's first click,
 * carrying off every key they had set. Nothing here can migrate a shape that
 * does not exist yet, so the change that moves this number is the change that
 * owes them a migration — or, failing that, the same refusal.
 */
export const SCHEMA_VERSION = 1;

/**
 * How long to wait before asking storage again, in milliseconds.
 *
 * Three tries, spread far enough apart to outlast the sort of failure this is
 * for — an extension reloaded under an open page, storage busy behind another
 * tab — and then it stops. Something still failing after five seconds is
 * failing for a reason waiting will not fix, and a page that asks forever is
 * a page that asks forever on every tab a reader has open.
 *
 * One schedule, because both sides of this are waiting on the same storage
 * for the same reasons, and both say so. Kept in two places that agreed, the
 * day one moved would be the day the comment on the other stopped being true
 * without anything saying so.
 *
 * Armed one at a time on both sides, and only where something is still
 * outstanding. Fired from a single instant, three tries against a slow
 * storage are three answers to the first question rather than three attempts
 * at it.
 */
export const RETRY_AFTER = [200, 1000, 5000];

/** A key a person set for a page, as it is kept. */
export interface KeyOverride {
  /** The tonic, spelled as `core` spells one: a letter and its accidentals. */
  readonly tonic: string;
  readonly mode: Mode;
}

/**
 * When each key was last used to name a chart, to the day.
 *
 * Kept so that the oldest can be dropped when there are too many, and kept
 * apart from the settings because it is written by a different hand for a
 * different reason. A page stamps the key it used; a reader changes a
 * setting; and a whole-object write from either would undo whatever the other
 * had just done. Two keys in storage cannot collide that way.
 *
 * Written no more than once a day per chart, because the alternative is a
 * storage write on every chart anyone opens.
 */
export type KeyStamps = Readonly<Record<string, number>>;

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
  /**
   * Whether the names were written onto the page.
   *
   * Said by the page rather than worked out by whoever reads this. The page
   * and a popup read the settings separately, and either read can fail or
   * catch a different moment — so a popup deciding from its own read would
   * tell a reader that six chords are named on a page showing none.
   */
  readonly applied: boolean;
  readonly updatedAt: number;
}

const SETTINGS_KEY = 'settings';
const STAMP_PREFIX = 'used:';
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
 *
 * The address and not the chart, which means one chart read at several
 * transpositions keeps several of these — the site serves each transposition
 * from its own address. What a key is kept under collapses them to one chart,
 * so nothing is duplicated that matters; what is spent is room among the
 * records, whose number is therefore charts times transpositions rather than
 * charts. It has to be the address: a popup has only the address of the tab
 * and cannot ask the page what chart it is on without permissions this
 * extension does without.
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

/**
 * When one chart's key was last used.
 *
 * One storage key per chart, so that a page writing its own can never write
 * over another's. Kept as one object they could: a page reads the lot, a
 * reader's popup prunes and writes the lot, and whichever finishes second
 * puts back what the first had just dropped.
 */
export async function loadStamp(pageId: string): Promise<number> {
  const key = `${STAMP_PREFIX}${pageId}`;
  const stored = (await browser.storage.local.get(key))[key];

  return typeof stored === 'number' ? stored : 0;
}

export async function saveStamp(pageId: string, at: number): Promise<void> {
  await browser.storage.local.set({ [`${STAMP_PREFIX}${pageId}`]: at });
}

/** Every chart's stamp at once, which only the pruning needs. */
export async function loadStamps(): Promise<KeyStamps> {
  const all = await browser.storage.local.get(null);

  const stamps = Object.entries(all)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .filter(([key]) => key.startsWith(STAMP_PREFIX))
    .map(([key, at]) => [key.slice(STAMP_PREFIX.length), at] as const);

  return Object.fromEntries(stamps);
}

/**
 * The settings and the stamps, written as one thing.
 *
 * In one call, because they are one answer: a reader who sets a key has
 * chosen the key and made it the most recently used, and a write that lands
 * halfway would have the popup say nothing was kept while the page went on
 * showing what it had kept.
 *
 * The stamps of keys that have gone are removed afterwards and separately.
 * Failing to remove them leaves records nothing reads, which the next write
 * clears; failing to write the settings has to be a failure.
 */
export async function saveKept(
  settings: Settings,
  stamps: KeyStamps,
  before: KeyStamps,
): Promise<void> {
  // Nothing at all where what is stored is not this build's. Writing would
  // put the defaults this build read over settings it could not read, and
  // every key the reader had set with them.
  //
  // Asked and acted on in two calls, which storage gives no way to make one:
  // a newer build writing between them is overwritten anyway. That window is
  // as wide as one storage read, and both sides of it are a reader working
  // the same profile from two builds of this extension at once — rare enough
  // to be worth a narrow window, and not worth the popup refusing to save
  // because someone else might be about to write.
  if (!(await storedSettingsAreReadable())) throw new Error('the stored settings are not readable');

  // Only the stamps that changed. Written whole, this would put back every
  // stamp as it stood when the popup read them — undoing a page that stamped
  // a key in the meantime, which is the clobber the split into one key per
  // chart was made to rule out. It would also write two hundred keys for a
  // checkbox.
  const changed = Object.entries(stamps)
    // Asked of the object itself, for the reason the removal below is: a bare
    // lookup finds a `constructor` on anything. It changes no answer here — an
    // inherited hit is never a time, so the stamp reads as changed, and a
    // stamp that is not in `before` has changed — but a reader should not have
    // to work that out to know the line is safe.
    .filter(([page, at]) => (Object.hasOwn(before, page) ? before[page] : undefined) !== at)
    .map(([page, at]) => [`${STAMP_PREFIX}${page}`, at]);

  await browser.storage.local.set({ [SETTINGS_KEY]: settings, ...Object.fromEntries(changed) });

  const gone = Object.keys(before)
    .filter((page) => !Object.hasOwn(stamps, page))
    .map((page) => `${STAMP_PREFIX}${page}`);

  // And a failure to remove them is not a failure. The caller shows a reader
  // that nothing was kept, which would be untrue: the settings are written,
  // the page is already following them, and what is left behind is a few
  // bytes nothing reads.
  //
  // Nothing sweeps them up on a schedule. What is removed is worked out from
  // the difference between what was read and what is being written, and a
  // change to the names or the numerals passes the stamps through unchanged
  // — so an orphan left here stays until the reader next sets or clears a key
  // on some chart. That is the price of not walking every key on every write,
  // and it is a few bytes.
  if (gone.length > 0) await browser.storage.local.remove(gone).catch(() => {});
}

/**
 * Whether what is stored is settings this build may write over.
 *
 * Asked before writing, because a read that falls back is not a write that
 * may. A reader who has been on a later build and comes back to this one has
 * settings this build cannot read — and a first click would write what it
 * read instead over everything they had, every key they had set among it, and
 * report that it worked.
 *
 * Only a later version is refused. An earlier one is a shape this build knows
 * what to replace, and refusing it would strand every reader on the day the
 * version first moves — told, untruthfully, that their settings came from
 * something newer.
 *
 * True where nothing is stored, which is a reader who has never set anything.
 */
export async function storedSettingsAreReadable(): Promise<boolean> {
  return !isFromLater((await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
}

/** The settings, and what they were read from. */
export interface StoredSettings {
  readonly settings: Settings;
  /**
   * Whether they came from a build after this one, and so may not be written
   * over.
   *
   * Read alongside the settings rather than asked for separately. Asked
   * afterwards, a caller showing the settings paints its controls first and
   * takes them away a moment later — and a reader who clicked inside that
   * moment is told the write failed rather than told why it was never going
   * to happen.
   */
  readonly fromLater: boolean;
  /**
   * False where something is stored and it is not settings this build knows.
   *
   * A caller showing the settings has to be able to say so. What it is
   * showing then is this build's defaults, and a control showing something
   * nobody chose is worse for being indistinguishable from one showing an
   * answer.
   */
  readonly understood: boolean;
}

/**
 * The settings as anything should act on them, or show them.
 *
 * Nothing done to any page where what is stored is not settings this build
 * knows — whether it came from a later build or from a shape nothing here can
 * account for. What would be used instead is this build's own defaults, which
 * say to rewrite every chart, and a reader who had turned that off would find
 * it back on.
 *
 * An earlier version is included: nothing is done to a page over one either.
 * Knowing what a shape is to be replaced with is not knowing what it said,
 * and the day the version first moves is the day the change that moved it
 * owes those readers a migration — until which their answers are as unread as
 * anyone else's. Where it differs is in the writing, which
 * {@link storedSettingsAreReadable} allows for an earlier version and refuses
 * for a later one.
 *
 * Here rather than in the settings themselves. A value nobody chose, sitting
 * where a setting goes, is one the next write takes for an answer — which is
 * why what is written starts from {@link StoredSettings.settings} and only
 * what is shown and acted on comes through here.
 */
export function asked({ settings, understood }: StoredSettings): Settings {
  return understood ? settings : { ...settings, enabled: false };
}

export async function readSettings(): Promise<StoredSettings> {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];

  return {
    settings: settingsIn(stored),
    fromLater: isFromLater(stored),
    understood: nothingStored(stored) || isSettings(stored),
  };
}

export async function loadSettings(): Promise<Settings> {
  return (await readSettings()).settings;
}

/**
 * What is stored, read as settings.
 *
 * Field by field, taking what is there only where it is one of the things
 * that field can be. A notation is used to choose a table of numerals, so one
 * this build has never heard of is not a setting it disagrees with — it is an
 * index into nothing, and the throw comes out of naming the chart.
 *
 * The likeliest way to get one is not corruption. Adding a third notation is
 * not a change of shape, so the version would not obviously move, and an
 * older build or a second profile would then read a value it cannot use.
 * Falling back a field at a time keeps the rest of a reader's settings.
 *
 * Every way in goes through here. Reading and being told about a change are
 * the same question asked twice, and a build whose reader is guarded and
 * whose listener is not is one where an extension updated under an open page
 * hands that page the value its own read would have turned away.
 */
function settingsIn(stored: unknown): Settings {
  // The defaults where nothing is stored, and where what is stored is not
  // settings this build knows.
  //
  // The defaults plainly, and not with the names turned off. Whether a page
  // should be left alone is a different question from what the settings are,
  // and folding the first into the second put a value nobody chose where a
  // setting goes — from which the next write took it and kept it, turning the
  // extension off for good over a change to something else. What to do about
  // settings that could not be read is {@link StoredSettings.understood}'s to
  // tell a caller, and the caller's to decide.
  if (!isSettings(stored)) return DEFAULT_SETTINGS;

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_SETTINGS.enabled,
    // Spread over rather than left to the spread. A stored object may carry
    // the field with nothing in it — the guard above allows that, and a
    // structured clone keeps it where a JSON round trip would drop it — and
    // an own property holding nothing replaces the default rather than
    // falling back to it.
    keyOverrides: isRecord(stored.keyOverrides)
      ? stored.keyOverrides
      : DEFAULT_SETTINGS.keyOverrides,
    notation: oneOf(NOTATIONS, stored.notation) ?? DEFAULT_SETTINGS.notation,
    spelling: oneOf(SPELLING_POLICIES, stored.spelling) ?? DEFAULT_SETTINGS.spelling,
  };
}

/** `value` where it is one of `allowed`, and nothing where it is not. */
function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find((one) => one === value);
}

/**
 * Calls back whenever the settings change, and hands back a way to stop.
 *
 * A content script and a popup are two readers of one setting, and the page
 * has to follow the popup without being asked twice.
 */
export function watchSettings(onChange: (stored: StoredSettings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;

    const change = changes[SETTINGS_KEY];
    if (!change) return;

    onChange({
      settings: settingsIn(change.newValue),
      fromLater: isFromLater(change.newValue),
      understood: nothingStored(change.newValue) || isSettings(change.newValue),
    });
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

/**
 * Calls back when what was found on this page is no longer in storage.
 *
 * Records are dropped by count, and nothing counting them knows which pages
 * are still open: a reader with a chart open who then browses enough charts
 * to fill the list has that chart's record thrown away under them, and the
 * popup tells them to open a chord chart on the chord chart they are looking
 * at. The page that wrote it is the one thing that can write it again.
 */
export function watchForgetting(key: string, onForgotten: () => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;

    // Whatever is there now is not a record, which covers a record removed
    // and one left in a shape this build cannot read. What a browser leaves
    // behind for a removed key differs — absent in one, null in another — and
    // asking what it is rather than what it is missing is the same question
    // without that difference in it.
    const change = changes[key];
    if (change && !isDetection(change.newValue)) onForgotten();
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
export async function pruneDetections(most = MOST_DETECTIONS, keep?: string | null): Promise<void> {
  const all = await browser.storage.local.get(null);

  // Every record, and not only the ones this build can read. A record written
  // in another shape is one nothing will ever read again, and leaving it out
  // of the count leaves it in storage for good — a bump to the version would
  // otherwise strand every record ever written while a fresh fifty pile up
  // beside them.
  // The one the reader is looking at counts as the newest, rather than being
  // taken out of the reckoning afterwards. It is the newest by every measure
  // that matters and the oldest by the only one there is — a record is
  // written once, so a chart left open while the reader browses has a stamp
  // that stops moving. Taken out afterwards it would keep its place in the
  // count as well as its record, and the store would settle one record above
  // the number it is being held to.
  const records = Object.entries(all)
    .filter(([key]) => key.startsWith(DETECTION_PREFIX))
    .map(([key, value]) => ({ key, updatedAt: isDetection(value) ? value.updatedAt : 0 }))
    .sort((a, b) => rank(b, keep) - rank(a, keep));

  const stale = records.slice(most).map((record) => record.key);
  if (stale.length > 0) await browser.storage.local.remove(stale);
}

/** Where a record sits in the reckoning, with the one being kept above all. */
function rank(record: { key: string; updatedAt: number }, keep?: string | null): number {
  return record.key === keep ? Number.POSITIVE_INFINITY : record.updatedAt;
}

/** How many pages this remembers reading, before the oldest are forgotten. */
export const MOST_DETECTIONS = 50;

/** How many charts a key can be kept for, before the least used are forgotten. */
export const MOST_OVERRIDES = 200;

/**
 * When a chart's key was last used, and nought where it never was.
 *
 * Asked of the object itself. A bare lookup finds a `constructor` on
 * anything, and what is looked up here is a chart's name — a function comes
 * back, the comparison against it is not a number, and a sort given one of
 * those puts the list in no particular order. What would be dropped at the
 * cap is then whichever keys the ordering happened to leave last.
 */
function usedAt(stamps: KeyStamps, pageId: string): number {
  return Object.hasOwn(stamps, pageId) ? (stamps[pageId] ?? 0) : 0;
}

/**
 * The overrides, with the least recently used dropped where there are too
 * many.
 *
 * A number rather than none, because a record kept for every chart anyone
 * ever opened grows without ever being read again.
 */
export function prunedOverrides(
  overrides: Readonly<Record<string, KeyOverride>>,
  stamps: KeyStamps,
  most = MOST_OVERRIDES,
): Record<string, KeyOverride> {
  const kept = Object.entries(overrides)
    .sort(([a], [b]) => usedAt(stamps, b) - usedAt(stamps, a))
    .slice(0, most);

  return Object.fromEntries(kept);
}

/** A day, which is how often a page's last-used stamp is worth rewriting. */
export const USED_AT_GRANULARITY = 24 * 60 * 60 * 1000;

/**
 * Whether what is stored was written by a build after this one.
 *
 * The version moving is a change of shape, and a shape from the future is one
 * this cannot guess at: a field may have been renamed, and reading the old
 * name would be reading something else. A shape from the past is the opposite
 * problem and a smaller one — this build knows what it is replacing — so it
 * is replaced rather than refused.
 *
 * When the version does move, that replacing is what a migration goes in
 * front of. There is nothing to migrate from yet, and a reader arriving here
 * with an older shape has settings this build will read as its defaults; the
 * day a second version exists, the change that adds it is the change that
 * owes them better.
 */
function isFromLater(value: unknown): boolean {
  return isRecord(value) && typeof value.version === 'number' && value.version > SCHEMA_VERSION;
}

/**
 * Whether a key holds nothing, which is a reader who has never set anything.
 *
 * Absent or null, because a browser that has just had a key removed says one
 * or the other and they do not agree about which — the same difference the
 * watcher for a forgotten record is written around. Read as "something is
 * there that cannot be read", a settings key removed on the browser that
 * says null would have every open chart strip its names and keep them off,
 * where a fresh install has them on.
 */
function nothingStored(value: unknown): boolean {
  return value === undefined || value === null;
}

/**
 * Whether stored settings are settings.
 *
 * The version, and then the fields that are read without being asked about.
 * `loadSettings` fills in what is missing from the defaults, which cannot
 * help with a field that is present and is the wrong thing: a `keyOverrides`
 * of `null` replaces the default and then every page throws on the first
 * thing it looks up. Reachable only from storage somebody has edited or
 * corrupted, which is reason enough to answer no rather than to trust it.
 */
function isSettings(value: unknown): value is Settings {
  if (!isRecord(value) || value.version !== SCHEMA_VERSION) return false;

  // Not an array, which `isRecord` would take for one of these. Read, it
  // degrades to nothing — no chart is named after a number — but the first
  // key a reader sets is spread over it, and the numbers come along as
  // overrides for charts that do not exist, taking places among the two
  // hundred kept and reachable from nowhere.
  const keys = value.keyOverrides;
  return keys === undefined || (isRecord(keys) && !Array.isArray(keys));
}

function isDetection(value: unknown): value is Detection {
  return (
    isRecord(value) &&
    value.version === SCHEMA_VERSION &&
    typeof value.pageId === 'string' &&
    // Read before it is compared. Records are ordered by this to decide which
    // are dropped, and a comparison against something that is not a number is
    // not a number — a sort given one of those leaves the list in no
    // particular order, and what is dropped is whatever the ordering happened
    // to leave last, the record the popup is about to show among it.
    typeof value.updatedAt === 'number' &&
    // Nothing else says whether the names went onto the page, and a record
    // without it would read as a page that named nothing. Better no record —
    // which the popup already has a line for, and which the page replaces on
    // its next run — than a confident wrong count.
    typeof value.applied === 'boolean'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
