import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  type Detection,
  isStored,
  loadSettings,
  loadStamp,
  loadStamps,
  MOST_DETECTIONS,
  pruneDetections,
  prunedOverrides,
  readDetection,
  readSettings,
  recordKey,
  SCHEMA_VERSION,
  type Settings,
  saveKept,
  saveStamp,
  watchSettings,
  writeDetection,
} from '@/settings/storage';

/** Writes settings the way the popup does, leaving the stamps alone. */
const saveOnly = (settings: Settings) => saveKept(settings, {}, {});

beforeEach(() => {
  fakeBrowser.reset();

  // Storage is faked per test and the spies over it are not: a spy left in
  // place is the same spy the next `spyOn` hands back, carrying every call
  // the test before it made.
  vi.restoreAllMocks();
});

const detection = (updatedAt: number): Detection => ({
  version: SCHEMA_VERSION,
  pageId: 'chordwiki:chart:Test Song',
  key: { tonic: 'C', mode: 'major' },
  source: 'page',
  statedKeys: 1,
  unreadKeys: 0,
  transposeOffset: 0,
  named: 4,
  applied: true,
  updatedAt,
});

describe('the key a page is remembered under', () => {
  // A popup reads the address of the tab and a content script writes the
  // address of the page, and a reader who follows an anchor leaves those two
  // different. The record would be written under one and looked for under the
  // other, and the popup would find nothing on a page it had just read.
  it('is the address without its fragment', () => {
    expect(recordKey('https://ja.chordwiki.org/wiki/Song#chorus')).toBe(
      recordKey('https://ja.chordwiki.org/wiki/Song'),
    );
  });

  it('keeps everything else about the address', () => {
    expect(recordKey('https://ja.chordwiki.org/wiki.cgi?c=view&t=Song&key=6')).not.toBe(
      recordKey('https://ja.chordwiki.org/wiki.cgi?c=view&t=Song'),
    );
  });

  // A popup can be opened on any tab, and a tab this extension has no
  // permission for reports no address at all. That is the state the popup is
  // in most of the time rather than a failure, and it must not throw.
  it.each([undefined, null, '', 'not an address'])('is nothing for %j', (address) => {
    expect(recordKey(address)).toBeNull();
  });
});

describe('reading settings that were never written', () => {
  it('gives the defaults', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('reading settings from a version this does not know', () => {
  // Guessing which fields moved is guessing, and a wrong guess is a reader's
  // settings quietly changed into something they did not choose. Nothing is
  // done to any page either: what this build would use instead says to
  // rewrite every chart, and a reader who had turned that off on a build that
  // knew how to say so would find it back on with no way to stop it.
  it('gives the defaults', async () => {
    await browser.storage.local.set({
      settings: { version: SCHEMA_VERSION + 1, enabled: true, notation: 'roman-unicode' },
    });

    // The defaults plainly. Whether a page should be left alone is a
    // different question from what the settings are, and a value nobody chose
    // sitting where a setting goes is one the next write takes for an answer.
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await readSettings()).toMatchObject({ understood: false, fromLater: true });
  });

  // An earlier version is a shape this build knows what to replace. Refused,
  // every reader would be stranded on the day the version first moves — and
  // told, untruthfully, that their settings came from something newer.
  it('reads an earlier version as the defaults, and lets them be written over', async () => {
    await browser.storage.local.set({
      settings: { version: SCHEMA_VERSION - 1, enabled: true },
    });

    // Read as the defaults and written over freely, which is how a reader
    // gets out of it. That no page is touched meanwhile is the caller's to
    // decide, from `understood`.
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect((await readSettings()).understood).toBe(false);
    await expect(saveKept(DEFAULT_SETTINGS, {}, {})).resolves.toBeUndefined();
  });

  it('fills in a field a known version did not have', async () => {
    await browser.storage.local.set({ settings: { version: SCHEMA_VERSION, enabled: false } });

    const settings = await loadSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.notation).toBe(DEFAULT_SETTINGS.notation);
  });
});

describe('reading settings that are not settings', () => {
  // Filling in what is missing from the defaults cannot help with a field
  // that is there and is the wrong thing: it replaces the default, and then
  // every page throws on the first thing it looks up.
  // A field this build did not find is filled in from the defaults. The same
  // line covers a field that is there and holds nothing, which a structured
  // clone keeps where a JSON round trip drops it — this storage drops it, so
  // that half is not what this case is exercising.
  it('fills in the keys where the field is not there', async () => {
    const { keyOverrides: _absent, ...rest } = DEFAULT_SETTINGS;
    await browser.storage.local.set({ settings: rest });

    expect((await loadSettings()).keyOverrides).toEqual({});
  });

  // And nothing done to any page, for the reason a later version's settings
  // leave every page alone: what would be used instead is this build's own
  // defaults, which say to rewrite every chart.
  // An array is an object, and read as one it degrades to nothing — no chart
  // is named after a number. What it does not survive is a key being set: the
  // first one is spread over it and the numbers come along as overrides for
  // charts that do not exist, taking places among the ones kept and reachable
  // from nowhere.
  it.each([null, 'nothing', 7, [], [{ tonic: 'C', mode: 'major' }]])(
    'gives the defaults where the keys are %j',
    async (overrides) => {
      await browser.storage.local.set({
        settings: { ...DEFAULT_SETTINGS, keyOverrides: overrides },
      });

      expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
      expect((await readSettings()).understood).toBe(false);
    },
  );

  // A browser that has just had a key removed says absent or null and they do
  // not agree about which. Read as "something is there that cannot be read",
  // a settings key removed on the one that says null would have every open
  // chart strip its names and keep them off, where a fresh install has them
  // on.
  //
  // Answered rather than stored, because this storage drops a null on the way
  // in and hands back an absent key — which is one of the two answers and not
  // the one this is about.
  it.each([undefined, null])('is understood where the key holds %j', async (stored) => {
    vi.spyOn(browser.storage.local, 'get').mockResolvedValue({ settings: stored } as never);

    expect(await readSettings()).toEqual({
      settings: DEFAULT_SETTINGS,
      fromLater: false,
      understood: true,
    });
  });

  it('is understood where nothing is stored at all', async () => {
    expect(await readSettings()).toEqual({
      settings: DEFAULT_SETTINGS,
      fromLater: false,
      understood: true,
    });
  });

  // Read alongside the settings rather than asked for afterwards: a popup
  // that asks afterwards paints its controls and takes them away a moment
  // later, and a reader who clicked inside that moment is told their change
  // could not be saved rather than told why it was never going to be.
  it('says where the settings came from in the same reading', async () => {
    await browser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, version: SCHEMA_VERSION + 1 },
    });

    expect(await readSettings()).toMatchObject({ fromLater: true, understood: false });
  });
});

describe('when a key was last used', () => {
  // Kept apart from the settings because it is written by a different hand
  // for a different reason: a page stamps the key it used while a reader is
  // changing a setting, and a whole-object write from either would undo the
  // other's.
  it('is written without touching the settings', async () => {
    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });
    await saveStamp('page', 5);

    expect((await loadSettings()).enabled).toBe(false);
    expect(await loadStamps()).toEqual({ page: 5 });
  });

  // One storage key per chart, and nothing else touched. Kept as one object,
  // a page writing its own stamp writes every other chart's with it — and a
  // page that read before the popup pruned puts back what the popup dropped.
  it('is written for one chart without writing another', async () => {
    await saveStamp('one', 1);
    await saveStamp('two', 2);

    const writes: string[][] = [];
    const real = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, 'set').mockImplementation((async (items: never) => {
      writes.push(Object.keys(items));
      return real(items);
    }) as never);

    await saveStamp('one', 3);

    expect(writes).toEqual([['used:one']]);
    expect(await loadStamps()).toEqual({ one: 3, two: 2 });
  });

  it('is nothing where nothing was written, and ignores what is not a time', async () => {
    expect(await loadStamp('page')).toBe(0);
    expect(await loadStamps()).toEqual({});

    await browser.storage.local.set({ 'used:page': 'yesterday' });
    expect(await loadStamp('page')).toBe(0);
    expect(await loadStamps()).toEqual({});
  });
});

describe('the settings and the stamps written together', () => {
  // A reader who sets a key has chosen the key and made it the most recently
  // used, and a write that landed halfway would have the popup say nothing
  // was kept while the page went on showing what it had kept.
  it('are one write', async () => {
    const writes: string[][] = [];
    const real = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, 'set').mockImplementation((async (items: never) => {
      writes.push(Object.keys(items));
      return real(items);
    }) as never);

    await saveKept({ ...DEFAULT_SETTINGS, enabled: false }, { page: 5 }, {});

    expect(writes).toEqual([['settings', 'used:page']]);
    expect((await loadSettings()).enabled).toBe(false);
    expect(await loadStamps()).toEqual({ page: 5 });
  });

  // Only the stamps that changed. Written whole, this would put back every
  // stamp as it stood when the popup read them — undoing a page that stamped
  // a key in the meantime — and would write two hundred keys for a checkbox.
  it('leave alone a stamp that did not change', async () => {
    await saveKept(DEFAULT_SETTINGS, { one: 1, two: 2 }, {});

    const writes: string[][] = [];
    const real = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, 'set').mockImplementation((async (items: never) => {
      writes.push(Object.keys(items));
      return real(items);
    }) as never);

    // A page stamps `one` while the popup holds what it read a moment ago.
    await saveStamp('one', 9);
    await saveKept({ ...DEFAULT_SETTINGS, enabled: false }, { one: 1, two: 2 }, { one: 1, two: 2 });

    expect(writes).toEqual([['used:one'], ['settings']]);
    expect(await loadStamps()).toEqual({ one: 9, two: 2 });
  });

  // Failing to forget one is not failing to save. The caller tells a reader
  // that nothing was kept, which would be untrue: the settings are written,
  // the page is already following them, and what is left behind is a record
  // nothing reads that the next write clears.
  it('are saved even where the stamps that have gone cannot be removed', async () => {
    await saveKept(DEFAULT_SETTINGS, { one: 1, two: 2 }, {});
    vi.spyOn(browser.storage.local, 'remove').mockRejectedValue(new Error('quota exceeded'));

    await saveKept({ ...DEFAULT_SETTINGS, enabled: false }, { one: 1 }, { one: 1, two: 2 });

    expect((await loadSettings()).enabled).toBe(false);
  });

  // Asked of the object itself. `in` finds a `constructor` on anything, so a
  // stamp for a chart called that would never be seen as gone.
  it.each(['constructor', 'toString', 'valueOf'])(
    'forget a stamp for a chart called %s',
    async (name) => {
      await saveStamp(name, 1);
      await saveKept(DEFAULT_SETTINGS, {}, { [name]: 1 });

      expect(await loadStamps()).toEqual({});
    },
  );

  // A stamp for a chart that has no key left is a record nothing reads.
  it('forget a stamp whose key has gone', async () => {
    await saveKept(DEFAULT_SETTINGS, { one: 1, two: 2 }, {});
    await saveKept(DEFAULT_SETTINGS, { one: 1 }, { one: 1, two: 2 });

    expect(await loadStamps()).toEqual({ one: 1 });
  });
});

describe('reading a setting this build has no name for', () => {
  // A notation chooses a table of numerals, so one this build has never heard
  // of is not a setting it disagrees with — it is an index into nothing, and
  // the throw comes out of naming the chart. Adding a third notation is not a
  // change of shape, so the version would not obviously move.
  it('falls back a field at a time rather than losing the rest', async () => {
    await browser.storage.local.set({
      settings: {
        ...DEFAULT_SETTINGS,
        enabled: false,
        notation: 'roman-numerals-in-a-circle',
        spelling: 'whatever',
      },
    });

    const settings = await loadSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.notation).toBe(DEFAULT_SETTINGS.notation);
    expect(settings.spelling).toBe(DEFAULT_SETTINGS.spelling);
  });

  // Reading and being told about a change are the same question asked twice.
  // An extension updated under an open page leaves the old content script
  // listening, and the new popup can write a value that build has no name
  // for — handed straight on, it throws where naming the chart happens and
  // the page falls back to chord names with nothing to say why.
  it('falls back the same way when it is told about a change', async () => {
    const seen = vi.fn();
    const stop = watchSettings(seen);

    await browser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, notation: 'roman-numerals-in-a-circle' },
    });

    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ notation: DEFAULT_SETTINGS.notation }),
      }),
    );
    stop();
  });

  it('keeps a setting it does have a name for', async () => {
    await browser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, notation: 'roman-unicode', spelling: 'source' },
    });

    const settings = await loadSettings();
    expect(settings.notation).toBe('roman-unicode');
    expect(settings.spelling).toBe('source');
  });
});

describe('writing over settings this build cannot read', () => {
  // A read that falls back is not a write that may. The defaults this build
  // read would go over settings it could not read, and every key the reader
  // had set with them.
  it('is refused', async () => {
    await browser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, version: SCHEMA_VERSION + 1, enabled: false },
    });

    await expect(saveKept(DEFAULT_SETTINGS, {}, {})).rejects.toThrow();
    expect(
      ((await browser.storage.local.get('settings')).settings as { version: number }).version,
    ).toBe(SCHEMA_VERSION + 1);
  });

  it('is allowed where nothing is stored at all', async () => {
    await expect(saveKept(DEFAULT_SETTINGS, {}, {})).resolves.toBeUndefined();
  });
});

describe('following a change to the settings', () => {
  it('hands the new settings to whoever is watching', async () => {
    const seen = vi.fn();
    const stop = watchSettings(seen);

    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });

    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ enabled: false }) }),
    );
    stop();
  });

  it('stops when it is told to', async () => {
    const seen = vi.fn();
    watchSettings(seen)();

    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });

    expect(seen).not.toHaveBeenCalled();
  });
});

describe('what was found on a page', () => {
  it('comes back as it was written', async () => {
    const key = recordKey('https://ja.chordwiki.org/wiki/Song');
    if (!key) throw new Error('that is an address');

    await writeDetection(key, detection(1));
    expect(await readDetection(key)).toEqual(detection(1));
  });

  it('is nothing where nothing was written', async () => {
    expect(await readDetection('detected:nothing')).toBeNull();
  });

  // A browser that has just had a key removed answers `undefined` or `null`
  // and they do not agree about which. Told that a removed record is still
  // there, a page making room for one would leave itself none — and would
  // fail to write for want of the room it had just decided it did not need.
  it('is not there where the browser answers null for a key it has removed', async () => {
    const real = browser.storage.local.get.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, 'get').mockImplementation((async (query: never) => {
      if (query === 'detected:gone') return { 'detected:gone': null };
      return real(query);
    }) as never);

    expect(await isStored('detected:gone')).toBe(false);
  });

  // Nothing else says whether the names went onto the page, so a record
  // without it would be read as a page that named nothing. Better no record,
  // which the popup has a line for and which the page writes again on its
  // next run, than a confident wrong count.
  it('is nothing where the record does not say what the page did', async () => {
    const { applied, ...rest } = detection(1);
    expect(applied).toBe(true);

    await browser.storage.local.set({ 'detected:partial': rest });
    expect(await readDetection('detected:partial')).toBeNull();
  });

  // Records are written on every chart anyone opens, and read only for the
  // one in front of them. Kept forever they would grow without ever being
  // looked at again.
  it('keeps the most recent and forgets the rest', async () => {
    const written = Array.from({ length: MOST_DETECTIONS + 10 }, (_, index) => index);
    for (const index of written) {
      await writeDetection(`detected:page-${index}`, detection(index));
    }

    await pruneDetections();

    expect(await readDetection('detected:page-0')).toBeNull();
    expect(await readDetection(`detected:page-${MOST_DETECTIONS + 9}`)).not.toBeNull();
    const all = await browser.storage.local.get(null);
    expect(Object.keys(all)).toHaveLength(MOST_DETECTIONS);
  });

  // A record written in a shape this build cannot read is a record nothing
  // will ever read again. Left out of the count it stays in storage for good,
  // and a bump to the version would strand every record ever written while a
  // fresh fifty piled up beside them.
  it('reclaims a record written in a shape it cannot read', async () => {
    await browser.storage.local.set({
      'detected:old': { pageId: 'chordwiki:chart:Old', version: SCHEMA_VERSION + 1 },
    });
    await writeDetection('detected:new', detection(2));

    await pruneDetections(1);

    const all = await browser.storage.local.get(null);
    expect(Object.keys(all)).toEqual(['detected:new']);
  });

  // The one the reader is looking at is the newest by every measure that
  // matters and the oldest by the only one there is: a record is written
  // once, so a chart left open while the reader browses has a stamp that
  // stops moving.
  // Records are ordered by when they were written to decide which are
  // dropped, and a comparison against something that is not a number is not a
  // number — a sort given one of those leaves the list in no particular
  // order, and what is dropped is whatever the ordering happened to leave
  // last, the record the popup is about to show among it.
  it('passes over a record whose time cannot be read', async () => {
    await browser.storage.local.set({
      'detected:broken': { ...detection(1), updatedAt: 'yesterday' },
    });
    await writeDetection('detected:kept', detection(2));

    await pruneDetections(1);

    expect(await readDetection('detected:kept')).not.toBeNull();
    expect((await browser.storage.local.get('detected:broken'))['detected:broken']).toBeUndefined();
  });

  it('keeps the one it is asked to keep, and counts it', async () => {
    await writeDetection('detected:open', detection(1));
    await writeDetection('detected:newer', detection(2));

    await pruneDetections(1, 'detected:open');

    // Counted as the newest rather than set aside: taken out of the reckoning
    // afterwards it would keep its place in the count as well as its record,
    // and the store would settle one above the number it is held to.
    expect(await readDetection('detected:open')).not.toBeNull();
    expect(await readDetection('detected:newer')).toBeNull();
  });

  // The settings live in the same storage area and are not a page record.
  it('leaves the settings alone', async () => {
    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });
    await writeDetection('detected:page', detection(1));

    await pruneDetections(0);

    expect((await loadSettings()).enabled).toBe(false);
  });
});

describe('keys kept for too many charts', () => {
  // Asked of the object itself. A bare lookup finds a `constructor` on
  // anything, and a comparison against a function is not a number — a sort
  // given one of those puts the list in no particular order, so what is
  // dropped at the cap is whichever keys the ordering happened to leave last.
  it('drops the least recently used where a chart is called constructor', () => {
    const overrides = {
      constructor: { tonic: 'C', mode: 'major' as const },
      used: { tonic: 'D', mode: 'major' as const },
    };

    expect(Object.keys(prunedOverrides(overrides, { used: 1 }, 1))).toEqual(['used']);
  });

  const overrides = {
    old: { tonic: 'C', mode: 'major' as const },
    newer: { tonic: 'D', mode: 'major' as const },
    newest: { tonic: 'E', mode: 'major' as const },
  };

  it('drops the least recently used', () => {
    const stamps = { old: 1, newer: 2, newest: 3 };
    expect(Object.keys(prunedOverrides(overrides, stamps, 2))).toEqual(['newest', 'newer']);
  });

  it('keeps everything where there is room', () => {
    expect(prunedOverrides(overrides, { old: 1, newer: 2, newest: 3 }, 200)).toEqual(overrides);
  });

  // A key set and never used again has no stamp of its own. It is the oldest
  // thing there is rather than the newest, which is what dropping the least
  // recently used has to mean.
  it('treats a key never used as older than one that has been', () => {
    const stamps = { newer: 2 };
    expect(Object.keys(prunedOverrides(overrides, stamps, 1))).toEqual(['newer']);
  });
});
