// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { run } from '@/content/run';
import type { Key, Mode } from '@/core/key';
import { parseNote } from '@/core/pitch';
import { type Kept, withOverride } from '@/settings/overrides';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  loadStamp,
  MOST_DETECTIONS,
  readDetection,
  recordKey,
  SCHEMA_VERSION,
  type Settings,
  saveKept,
  saveStamp,
  writeDetection,
} from '@/settings/storage';

/** Writes settings the way the popup does, leaving the stamps alone. */
const saveOnly = (settings: Settings) => saveKept(settings, {}, {});

import { chordwiki } from '@/sites/chordwiki/adapter';

const FIXTURES = join(import.meta.dirname, '../fixtures');

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

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

const EMPTY: Kept = { settings: DEFAULT_SETTINGS, stamps: {} };
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
    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });

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
  // The defaults say to rewrite every chart, and a reader who has turned that
  // off has said the opposite. A setting that cannot be read is not a setting
  // that was never made, so the page is left as the site served it.
  it('leaves the chart alone rather than writing on it with the defaults', async () => {
    vi.spyOn(browser.storage.local, 'get').mockRejectedValue(new Error('context invalidated'));

    const doc = load('chordwiki-basic');
    const stop = await run(doc, chordwiki, new URL(ADDRESS));

    expect(shown(doc)[0]).toBe('C');
    stop();
  });

  // Read all the same, so the popup has something to say about the page even
  // where nothing could be done to it.
  it('still reads the chart', async () => {
    const real = browser.storage.local.get.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, 'get').mockImplementation((async (query: never) => {
      if (query === 'settings') throw new Error('context invalidated');
      return real(query);
    }) as never);

    const doc = load('chordwiki-basic');
    const stop = await run(doc, chordwiki, new URL(ADDRESS));

    expect(await readDetection(RECORD)).toMatchObject({ source: 'page', named: 6 });
    stop();
  });
});

describe('a page whose settings are not settings', () => {
  // What would be used instead is this build's own defaults, which say to
  // rewrite every chart — and a reader who had turned that off, on a build
  // that knew how to say so, would find it back on. Decided here rather than
  // carried in the settings: a value nobody chose, sitting where a setting
  // goes, is one the next write takes for an answer.
  it.each([
    ['from a later build', { ...DEFAULT_SETTINGS, version: SCHEMA_VERSION + 1 }],
    ['in a shape nothing accounts for', { ...DEFAULT_SETTINGS, keyOverrides: 7 }],
    // Included, though they may be written over. Knowing what a shape is to
    // be replaced with is not knowing what it said, and until the change that
    // moves the version brings a migration those answers are as unread as
    // anyone else's.
    ['from an earlier build', { ...DEFAULT_SETTINGS, version: SCHEMA_VERSION - 1 }],
  ])('leaves the chart alone where they are %s', async (_what, settings) => {
    await browser.storage.local.set({ settings });

    const doc = load('chordwiki-basic');
    const stop = await start(doc);

    expect(shown(doc)[0]).toBe('C');
    expect(await readDetection(RECORD)).toMatchObject({ source: 'page' });
    stop();
  });
});

describe('following the settings', () => {
  it('names the chart again when a setting changes', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);

    await saveOnly({ ...DEFAULT_SETTINGS, notation: 'roman-unicode' });
    await Promise.resolve();

    expect(shown(doc)[1]).toBe('Ⅵm7');

    stop();
  });

  it('takes the names off when it is switched off, and puts the page back', async () => {
    const doc = load('chordwiki-basic');
    const before = doc.body.innerHTML;
    const stop = await start(doc);

    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });
    await Promise.resolve();

    expect(doc.body.innerHTML).toBe(before);

    stop();
  });

  it('stops listening when it is told to', async () => {
    const doc = load('chordwiki-basic');
    (await start(doc))();

    await saveOnly({ ...DEFAULT_SETTINGS, notation: 'roman-unicode' });
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
    await saveOnly(withOverride(EMPTY, PAGE, key('G'), 0, 1).settings);
    await saveStamp(PAGE, Date.now() - 25 * 60 * 60 * 1000);

    const doc = load('chordwiki-basic');
    const running = run(doc, chordwiki, new URL(ADDRESS));

    await saveOnly({ ...(await loadSettings()), enabled: false, notation: 'roman-unicode' });
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
    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });
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
    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });

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
    await saveOnly({ ...DEFAULT_SETTINGS, notation: 'roman-unicode' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown(doc)[1]).toBe('Am7');

    breaking = false;
    await saveOnly({ ...DEFAULT_SETTINGS, spelling: 'source' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shown(doc)[1]).toBe('VIm7');
    stop();
  });
});

describe('a key kept for a chart that has since been given two', () => {
  // `apply` follows a chart that states more than one key rather than a key
  // set for the page, so the key is not used. Stamped anyway, an inert key
  // would keep itself fresh on every visit and outlive keys that are doing
  // something.
  it('is not marked as used', async () => {
    await saveOnly(withOverride(EMPTY, PAGE, key('G'), 0, 1).settings);
    await saveStamp(PAGE, 1);

    const doc = parse(`
      <div class="main">
        <p class="key">Key: C</p>
        <p class="line"><span class="chord">Am7</span></p>
        <p class="key">Key: G</p>
        <p class="line"><span class="chord">Am7</span></p>
      </div>
    `);

    (await run(doc, chordwiki, new URL(ADDRESS)))();

    expect(await readDetection(RECORD)).toMatchObject({ source: 'page', statedKeys: 2 });
    expect(await loadStamp(PAGE)).toBe(1);
  });
});

describe('a reading whose record could not be written', () => {
  // The popup reads what was written down, and what is on the page and what
  // was written down are two questions. Tied to the repaint, a record that
  // failed to write goes on describing the chart as it was before the
  // reader's last change until something makes the page repaint — which a
  // change about another chart, rightly, does not.
  it('is written again at the next change, whatever the change was about', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);

    const real = browser.storage.local.set.bind(browser.storage.local);
    const failing = vi.spyOn(browser.storage.local, 'set').mockImplementation((async (
      items: never,
    ) => {
      if (Object.keys(items).some((name) => name.startsWith('detected:'))) {
        throw new Error('quota exceeded');
      }
      return real(items);
    }) as never);

    // Taken away with nothing able to put it back, so that what follows
    // starts from a page whose record is missing.
    await browser.storage.local.remove(RECORD);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await saveOnly({ ...DEFAULT_SETTINGS, notation: 'roman-unicode' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await readDetection(RECORD)).toBeNull();
    failing.mockRestore();

    // A key set for another chart, which this page is right not to repaint
    // for — and which must still let it write down what it is showing.
    const elsewhere: Kept = {
      settings: { ...DEFAULT_SETTINGS, notation: 'roman-unicode' },
      stamps: {},
    };
    await saveOnly(
      withOverride(elsewhere, 'chordwiki:chart:Another Song', key('G'), 0, 1).settings,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await readDetection(RECORD)).toMatchObject({ named: 6 });
    expect(shown(doc)[1]).toBe('Ⅵm7');
    stop();
  });
});

describe('records of pages the reader has left', () => {
  // Tidying only where somebody asked for something leaves a reader who never
  // opens the popup keeping a record of every chart they have ever read — and
  // a store that fills is one where the next record does not write, after
  // which the popup, on a chart, tells them to open a chord chart.
  it('are tidied by a page that opens, not only by the popup', async () => {
    for (let index = 0; index < MOST_DETECTIONS + 5; index++) {
      await writeDetection(`detected:page-${index}`, {
        version: SCHEMA_VERSION,
        pageId: `chordwiki:chart:${index}`,
        key: null,
        source: null,
        statedKeys: 0,
        unreadKeys: 0,
        transposeOffset: 0,
        named: 0,
        updatedAt: index,
      });
    }

    (await start(load('chordwiki-basic')))();

    const all = await browser.storage.local.get(null);
    const records = Object.keys(all).filter((key) => key.startsWith('detected:'));
    expect(records).toHaveLength(MOST_DETECTIONS);

    // Including this page's own, which is what it was asked to keep.
    expect(await readDetection(RECORD)).not.toBeNull();
  });

  // The reader is sitting on the page, so neither a settings change nor its
  // coming back into view is going to happen on its own — a record that
  // failed to write for want of room has to be tried again here or not at
  // all.
  it('are tidied and the record written again where the store had no room', async () => {
    const real = browser.storage.local.set.bind(browser.storage.local);
    let full = true;
    vi.spyOn(browser.storage.local, 'set').mockImplementation((async (items: never) => {
      if (full && Object.keys(items).some((name) => name.startsWith('detected:'))) {
        full = false;
        throw new Error('quota exceeded');
      }
      return real(items);
    }) as never);

    (await start(load('chordwiki-basic')))();

    expect(await readDetection(RECORD)).toMatchObject({ named: 6 });
  });

  // Once for each page a reader opens, and not for each time it is read:
  // changing a setting must not walk the whole of storage on every open tab.
  it('are not tidied again every time the page is read', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);

    const everything = vi.spyOn(browser.storage.local, 'get');
    await saveOnly({ ...DEFAULT_SETTINGS, notation: 'roman-unicode' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(everything.mock.calls.filter(([query]) => query === null)).toHaveLength(0);
    stop();
  });
});

describe('a record thrown away while the page is still open', () => {
  // Records are dropped by count and nothing counting them knows which pages
  // are open, so a chart left open while the reader browses can have its own
  // record dropped under it — after which the popup tells them to open a
  // chord chart on the chord chart in front of them.
  it('is written again by the page that wrote it', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);
    expect(await readDetection(RECORD)).not.toBeNull();

    await browser.storage.local.remove(RECORD);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await readDetection(RECORD)).toMatchObject({ named: 6, source: 'page' });
    stop();
  });

  // The writing takes a turn of the loop, and the record can be thrown away
  // inside it. Marked as written afterwards regardless, the page would take
  // back what the watcher had just asked for and the record would stay gone.
  it('is written again where it went while it was being written', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);

    const real = browser.storage.local.set.bind(browser.storage.local);
    let taken = false;
    vi.spyOn(browser.storage.local, 'set').mockImplementation((async (items: never) => {
      const writing = real(items);

      // Thrown away once, while the write it is answering is still in flight.
      if (!taken && Object.keys(items).some((name) => name.startsWith('detected:'))) {
        taken = true;
        await browser.storage.local.remove(RECORD);
      }

      return writing;
    }) as never);

    await saveOnly({ ...DEFAULT_SETTINGS, notation: 'roman-unicode' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.restoreAllMocks();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await readDetection(RECORD)).toMatchObject({ named: 6 });
    stop();
  });

  // Written back only where the page is being looked at. The popup drops the
  // oldest records, and every open tab putting its own straight back would
  // leave the store above the number it is held to and the tidying nothing
  // but a burst of writes. A record is read by a popup, and a popup is opened
  // over the page in front of the reader.
  it('is not written again by a page nobody is looking at', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);
    Object.defineProperty(doc, 'hidden', { value: true, configurable: true });

    await browser.storage.local.remove(RECORD);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await readDetection(RECORD)).toBeNull();
    stop();
  });

  // And written when the reader comes back to it.
  it('is written again when the page is looked at again', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);
    Object.defineProperty(doc, 'hidden', { value: true, configurable: true });

    await browser.storage.local.remove(RECORD);
    await new Promise((resolve) => setTimeout(resolve, 0));

    Object.defineProperty(doc, 'hidden', { value: false, configurable: true });
    doc.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await readDetection(RECORD)).toMatchObject({ named: 6 });
    stop();
  });

  it('stops being written again once the page has gone', async () => {
    const doc = load('chordwiki-basic');
    (await start(doc))();

    await browser.storage.local.remove(RECORD);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await readDetection(RECORD)).toBeNull();
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

    await saveOnly(withOverride(EMPTY, OTHER, key('G'), 0, 1).settings);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readings(wrote)).toBe(0);
    stop();
  });

  // Nor does a stamp moving, which is written by whichever page used the key
  // and is displayed nowhere.
  it('does not make the page read itself again for a stamp either', async () => {
    await saveOnly(withOverride(EMPTY, 'chordwiki:chart:Test Song', key('G'), 0, 1).settings);

    const doc = load('chordwiki-basic');
    const stop = await start(doc);
    const wrote = vi.spyOn(browser.storage.local, 'set');

    await saveOnly(withOverride(EMPTY, 'chordwiki:chart:Test Song', key('G'), 0, 1).settings);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readings(wrote)).toBe(0);
    stop();
  });

  // And a change that does reach this page still does.
  it('reads itself again where the change is about this chart', async () => {
    const doc = load('chordwiki-basic');
    const stop = await start(doc);

    await saveOnly(withOverride(EMPTY, 'chordwiki:chart:Test Song', key('G'), 0, 1).settings);
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

    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shown(doc)[0]).toBe('C');
    stop();
  });
});

describe('a key set for the chart', () => {
  it('is used, and named as set by hand', async () => {
    const doc = load('chordwiki-basic');
    await saveOnly(withOverride(EMPTY, 'chordwiki:chart:Test Song', key('G'), 0, 1).settings);

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
    await saveOnly(withOverride(EMPTY, 'chordwiki:chart:Test Song', key('C'), 0, 1).settings);

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
  // A stamp written while the clock was ahead of itself is in the future once
  // the clock is put right. Read as "how much later is now", that key would be
  // fresh for good — never re-stamped, never the oldest, never dropped, while
  // keys the reader actually uses go around it.
  it('is stamped again where the stamp is in the future', async () => {
    await saveOnly(withOverride(EMPTY, PAGE, key('G'), 0, 1).settings);
    const ahead = Date.now() + 25 * 60 * 60 * 1000;
    await saveStamp(PAGE, ahead);

    (await start(load('chordwiki-basic')))();

    expect(await loadStamp(PAGE)).toBeLessThan(ahead);
  });

  // The record write is the one of the two that can fail on a page that is
  // otherwise fine. Written first, a failure would carry off the stamp with
  // it — and a key used every day on a page whose records will not write
  // would age towards being dropped while keys nobody touches do not.
  it('is stamped even where what was found could not be written down', async () => {
    await saveOnly(withOverride(EMPTY, PAGE, key('G'), 0, 1).settings);
    await saveStamp(PAGE, 1);

    const real = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, 'set').mockImplementation((async (items: never) => {
      if (Object.keys(items).some((name) => name.startsWith('detected:'))) {
        throw new Error('quota exceeded');
      }
      return real(items);
    }) as never);

    (await start(load('chordwiki-basic')))();

    expect(await loadStamp(PAGE)).toBeGreaterThan(1);
  });

  // A stamp that does not land costs a key some of its standing among the
  // ones kept; a record that does not land is a popup telling a reader to
  // open a chord chart on the chord chart they are looking at.
  it('does not carry off the record when it cannot be written', async () => {
    await saveOnly(withOverride(EMPTY, PAGE, key('G'), 0, 1).settings);

    const real = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, 'set').mockImplementation((async (items: never) => {
      if (Object.keys(items).some((name) => name.startsWith('used:'))) {
        throw new Error('quota exceeded');
      }
      return real(items);
    }) as never);

    (await start(load('chordwiki-basic')))();

    expect(await readDetection(RECORD)).toMatchObject({ source: 'manual' });
  });

  it('is stamped as used no more than once a day', async () => {
    const doc = load('chordwiki-basic');
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    await saveOnly(withOverride(EMPTY, PAGE, key('G'), 0, 1).settings);
    await saveStamp(PAGE, yesterday);

    (await start(doc))();
    const stamped = await loadStamp(PAGE);
    expect(stamped).toBeGreaterThan(yesterday);

    (await start(load('chordwiki-basic')))();
    expect(await loadStamp(PAGE)).toBe(stamped);
  });
});
