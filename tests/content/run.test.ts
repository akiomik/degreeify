// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { run } from '@/content/run';
import type { Key, Mode } from '@/core/key';
import { parseNote } from '@/core/pitch';
import { withOverride } from '@/settings/overrides';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  loadStamps,
  readDetection,
  recordKey,
  saveSettings,
  saveStamps,
} from '@/settings/storage';
import { chordwiki } from '@/sites/chordwiki/adapter';

const FIXTURES = join(import.meta.dirname, '../fixtures');

const load = (name: string): Document =>
  new DOMParser().parseFromString(
    readFileSync(join(FIXTURES, `${name}.html`), 'utf8'),
    'text/html',
  );

const key = (tonic: string, mode: Mode = 'major'): Key => {
  const note = parseNote(tonic);
  if (!note) throw new Error(`${tonic} is not a note`);
  return { tonic: note, mode };
};

const ADDRESS = 'https://ja.chordwiki.org/wiki/Test%20Song';
const PAGE = 'chordwiki:chart:Test Song';
const RECORD = recordKey(ADDRESS) ?? '';

const shown = (doc: Document): string[] =>
  [...doc.querySelectorAll('p.line span.chord')].map((element) => element.textContent ?? '');

/** Runs the extension the way the content script does, and stops listening. */
const start = async (doc: Document, address = ADDRESS) => {
  const stop = await run(doc, chordwiki, new URL(address));
  return stop;
};

beforeEach(() => {
  fakeBrowser.reset();

  // Storage is faked per test and the spies over it are not: a spy left in
  // place is the same spy the next `spyOn` hands back, carrying every call
  // the test before it made.
  vi.restoreAllMocks();
});

describe('running on a chart', () => {
  it('names the chart and writes down what it found', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);

    expect(shown(doc)[0]).toBe('I');
    expect(await readDetection(RECORD)).toMatchObject({
      pageId: 'chordwiki:chart:Test Song',
      key: { tonic: 'C', mode: 'major' },
      source: 'page',
      statedKeys: 1,
      unreadKeys: 0,
      transposeOffset: 0,
      named: 6,
    });

    stop();
  });

  // Being switched off means the page is left as the site served it, not that
  // nothing is known about it. A reader with the names off can still be shown
  // what key the chart is in, and would find that display empty for no reason
  // they could see if the reading stopped here.
  it('reads a chart it has been told not to name', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });

    const doc = load('chordwiki-basic');
    const stop = await start(doc);

    expect(shown(doc)[0]).toBe('C');
    expect(await readDetection(RECORD)).toMatchObject({ source: 'page', named: 6 });

    stop();
  });

  it('does nothing at all on a page that holds no chart', async () => {
    const doc = new DOMParser().parseFromString('<p>Search results</p>', 'text/html');
    const stop = await start(doc);

    expect(await readDetection(RECORD)).toBeNull();

    stop();
  });
});

describe('a page whose settings cannot be read', () => {
  // Before there were settings this needed no storage at all. A storage read
  // that throws — an extension reloaded out from under an open page is the
  // ordinary way — must not be the difference between a chart in degree names
  // and a chart in none.
  it('names the chart with the defaults rather than not at all', async () => {
    vi.spyOn(browser.storage.local, 'get').mockRejectedValue(new Error('context invalidated'));

    const doc = load('chordwiki-basic');
    const stop = await run(doc, chordwiki, new URL(ADDRESS));

    expect(shown(doc)[0]).toBe('I');
    stop();
  });
});

describe('following the settings', () => {
  it('names the chart again when a setting changes', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);

    await saveSettings({ ...DEFAULT_SETTINGS, notation: 'roman-unicode' });
    await Promise.resolve();

    expect(shown(doc)[1]).toBe('Ⅵm7');

    stop();
  });

  it('takes the names off when it is switched off, and puts the page back', async () => {
    const doc = load('chordwiki-basic');
    const before = doc.body.innerHTML;
    const stop = await start(doc);

    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });
    await Promise.resolve();

    expect(doc.body.innerHTML).toBe(before);

    stop();
  });

  it('stops listening when it is told to', async () => {
    const doc = load('chordwiki-basic');
    (await start(doc))();

    await saveSettings({ ...DEFAULT_SETTINGS, notation: 'roman-unicode' });
    await Promise.resolve();

    expect(shown(doc)[1]).toBe('VIm7');
  });
});

describe('a setting changed while the page is still being read', () => {
  // The page is read, measured and named before anything is written back, and
  // a reader can reach the popup in that time. Written back from the settings
  // this page started with, whatever they changed would be undone — and the
  // only sign of it would be a setting that went back on its own.
  it('is not undone by the page writing down that it used a key', async () => {
    await saveSettings(withOverride(DEFAULT_SETTINGS, PAGE, key('G'), 0, {}));
    await saveStamps({ [PAGE]: Date.now() - 25 * 60 * 60 * 1000 });

    const doc = load('chordwiki-basic');
    const running = run(doc, chordwiki, new URL(ADDRESS));

    await saveSettings({ ...(await loadSettings()), enabled: false, notation: 'roman-unicode' });
    (await running)();

    const settings = await loadSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.notation).toBe('roman-unicode');
  });

  // A reader can reach the popup while the page is still being read, and the
  // last thing that reading does is write down what it found. Told to listen
  // only after all of that, a change made in the meantime is heard by nobody
  // and the page goes on showing what it was asked for before. The write is
  // slowed here so the change lands squarely inside that window.
  it('is followed even where it happened while the page was still being read', async () => {
    const real = browser.storage.local.set.bind(browser.storage.local);
    const slow = vi.spyOn(browser.storage.local, 'set').mockImplementation((async (
      items: Record<string, unknown>,
    ) => {
      if (Object.keys(items).some((key) => key.startsWith('detected:'))) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return real(items);
    }) as never);

    const doc = load('chordwiki-basic');
    const running = run(doc, chordwiki, new URL(ADDRESS));

    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });
    slow.mockRestore();

    const stop = await running;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shown(doc)[0]).toBe('C');
    stop();
  });
});

describe('a setting changed while the first reading is being loaded', () => {
  // Listening first is necessary and not sufficient: awaited rather than
  // queued, the settings read before the change are the ones handed over
  // last, and they win. A reader who turned the names off inside that window
  // would watch them stay on until they reloaded the page.
  it('wins over the settings the page had started reading', async () => {
    const real = browser.storage.local.get.bind(browser.storage.local);
    // Sampled when it is asked and handed back late, which is what a slow
    // read is. Read late instead, it would see the change and the point would
    // be lost: what is pinned here is a read that answers with what was there
    // before the reader touched anything.
    const slow = vi.spyOn(browser.storage.local, 'get').mockImplementation((async (
      query: never,
    ) => {
      const value = await real(query);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return value;
    }) as never);

    const doc = load('chordwiki-basic');
    const running = run(doc, chordwiki, new URL(ADDRESS));

    await new Promise((resolve) => setTimeout(resolve, 5));
    slow.mockRestore();
    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });

    const stop = await running;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(shown(doc)[0]).toBe('C');
    stop();
  });
});

describe('a showing that failed', () => {
  // `apply` puts the page back before it reads, so a reading that throws
  // leaves the chart in chord names — which is the honest state for a page
  // this can no longer read. What must not happen is that it stays there:
  // the next change has to be acted on.
  it('leaves the chart in chord names and goes on following the settings', async () => {
    let breaking = false;
    const brittle = {
      ...chordwiki,
      readChart: (doc: Document) => {
        if (breaking) throw new Error('the page moved');
        return chordwiki.readChart(doc);
      },
    };

    const doc = load('chordwiki-basic');
    const stop = await run(doc, brittle, new URL(ADDRESS));

    breaking = true;
    await saveSettings({ ...DEFAULT_SETTINGS, notation: 'roman-unicode' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown(doc)[1]).toBe('Am7');

    breaking = false;
    await saveSettings({ ...DEFAULT_SETTINGS, spelling: 'source' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shown(doc)[1]).toBe('VIm7');
    stop();
  });
});

describe('a settings change about somewhere else', () => {
  const OTHER = 'chordwiki:chart:Another Song';

  /**
   * How many times the page has written down what it found.
   *
   * Which is what reading the page again costs: a restore, a re-measure, a
   * rewrite and a record. Counted through the record because that is the one
   * part of it a test can see from outside.
   */
  const readings = (wrote: { mock: { calls: unknown[][] } }) =>
    wrote.mock.calls.filter(([items]) =>
      Object.keys(items as Record<string, unknown>).some((name) => name.startsWith('detected:')),
    ).length;

  // A key set for one chart is heard by every page open on the site. Each of
  // them reading, restoring, measuring and rewriting itself over a key that
  // is not theirs is a flicker on every other tab, every time.
  it('does not make the page read itself again', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);
    const wrote = vi.spyOn(browser.storage.local, 'set');

    await saveSettings(withOverride(DEFAULT_SETTINGS, OTHER, key('G'), 0, {}));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readings(wrote)).toBe(0);
    stop();
  });

  // Nor does a stamp moving, which is written by whichever page used the key
  // and is displayed nowhere.
  it('does not make the page read itself again for a stamp either', async () => {
    await saveSettings(
      withOverride(DEFAULT_SETTINGS, 'chordwiki:chart:Test Song', key('G'), 0, {}),
    );

    const doc = load('chordwiki-basic');
    const stop = await start(doc);
    const wrote = vi.spyOn(browser.storage.local, 'set');

    await saveSettings(
      withOverride(DEFAULT_SETTINGS, 'chordwiki:chart:Test Song', key('G'), 0, {}),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readings(wrote)).toBe(0);
    stop();
  });

  // And a change that does reach this page still does.
  it('reads itself again where the change is about this chart', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);

    await saveSettings(
      withOverride(DEFAULT_SETTINGS, 'chordwiki:chart:Test Song', key('G'), 0, {}),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shown(doc)[0]).toBe('IV');
    stop();
  });
});

describe('a page that could not write down what it found', () => {
  // One rejected write must not be the last thing the page ever does. A
  // promise that has rejected passes over every continuation after it, so a
  // chain built only of `then` would stop following the settings for good —
  // silently, and for the rest of the page's life.
  it('goes on following the settings', async () => {
    const doc = load('chordwiki-basic');
    const failing = vi
      .spyOn(browser.storage.local, 'set')
      .mockRejectedValueOnce(new Error('quota exceeded'));

    const stop = await run(doc, chordwiki, new URL(ADDRESS)).catch(() => () => {});
    failing.mockRestore();

    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shown(doc)[0]).toBe('C');
    stop();
  });
});

describe('a key set for the chart', () => {
  it('is used, and named as set by hand', async () => {
    const doc = load('chordwiki-basic');
    await saveSettings(
      withOverride(DEFAULT_SETTINGS, 'chordwiki:chart:Test Song', key('G'), 0, {}),
    );

    const stop = await start(doc);

    expect(shown(doc)[0]).toBe('IV');
    expect(await readDetection(RECORD)).toMatchObject({ source: 'manual' });

    stop();
  });

  // The chart is being shown six semitones up, and the key was set for the
  // chart as written. What a reader set has to survive their pressing a
  // button that changes nothing about the song.
  it('moves with a chart that has been transposed', async () => {
    const doc = load('chordwiki-transposed');
    await saveSettings(
      withOverride(DEFAULT_SETTINGS, 'chordwiki:chart:Test Song', key('C'), 0, {}),
    );

    const stop = await start(doc);

    expect(await readDetection(RECORD)).toMatchObject({
      key: { tonic: 'Gb', mode: 'major' },
      source: 'manual',
      transposeOffset: 6,
    });

    stop();
  });

  // The stamp decides which keys are dropped when there are too many, so it
  // has to be written — but not on every chart a reader opens, which would be
  // a storage write for every page they look at.
  it('is stamped as used no more than once a day', async () => {
    const doc = load('chordwiki-basic');
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    await saveSettings(withOverride(DEFAULT_SETTINGS, PAGE, key('G'), 0, {}));
    await saveStamps({ [PAGE]: yesterday });

    (await start(doc))();
    const stamped = (await loadStamps())[PAGE] ?? 0;
    expect(stamped).toBeGreaterThan(yesterday);

    (await start(load('chordwiki-basic')))();
    expect((await loadStamps())[PAGE]).toBe(stamped);
  });
});
