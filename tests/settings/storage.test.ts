import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  type Detection,
  loadSettings,
  loadStamps,
  MOST_DETECTIONS,
  pruneDetections,
  prunedOverrides,
  readDetection,
  recordKey,
  SCHEMA_VERSION,
  saveSettings,
  saveStamps,
  watchSettings,
  writeDetection,
} from '@/settings/storage';

beforeEach(() => {
  fakeBrowser.reset();
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
  // settings quietly changed into something they did not choose.
  it('gives the defaults rather than reading them anyway', async () => {
    await browser.storage.local.set({
      settings: { version: SCHEMA_VERSION + 1, enabled: false, notation: 'roman-unicode' },
    });

    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
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
  it.each([null, 'nothing', 7])('gives the defaults where the keys are %j', async (overrides) => {
    await browser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, keyOverrides: overrides },
    });

    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('when a key was last used', () => {
  // Kept apart from the settings because it is written by a different hand
  // for a different reason: a page stamps the key it used while a reader is
  // changing a setting, and a whole-object write from either would undo the
  // other's.
  it('is written without touching the settings', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });
    await saveStamps({ page: 5 });

    expect((await loadSettings()).enabled).toBe(false);
    expect(await loadStamps()).toEqual({ page: 5 });
  });

  it('is nothing where nothing was written, and ignores what is not a time', async () => {
    expect(await loadStamps()).toEqual({});

    await browser.storage.local.set({ used: { page: 'yesterday', other: 3 } });
    expect(await loadStamps()).toEqual({ other: 3 });
  });
});

describe('following a change to the settings', () => {
  it('hands the new settings to whoever is watching', async () => {
    const seen = vi.fn();
    const stop = watchSettings(seen);

    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });

    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    stop();
  });

  it('stops when it is told to', async () => {
    const seen = vi.fn();
    watchSettings(seen)();

    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });

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

  // The settings live in the same storage area and are not a page record.
  it('leaves the settings alone', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });
    await writeDetection('detected:page', detection(1));

    await pruneDetections(0);

    expect((await loadSettings()).enabled).toBe(false);
  });
});

describe('keys kept for too many charts', () => {
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
