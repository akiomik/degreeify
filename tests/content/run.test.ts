// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { run } from '@/content/run';
import type { Key, Mode } from '@/core/key';
import { parseNote } from '@/core/pitch';
import { withOverride } from '@/settings/overrides';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  readDetection,
  recordKey,
  saveSettings,
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

describe('a key set for the chart', () => {
  it('is used, and named as set by hand', async () => {
    const doc = load('chordwiki-basic');
    await saveSettings(
      withOverride(DEFAULT_SETTINGS, 'chordwiki:chart:Test Song', key('G'), 0, Date.now()),
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
      withOverride(DEFAULT_SETTINGS, 'chordwiki:chart:Test Song', key('C'), 0, Date.now()),
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
    await saveSettings(
      withOverride(DEFAULT_SETTINGS, 'chordwiki:chart:Test Song', key('G'), 0, yesterday),
    );

    (await start(doc))();
    const stamped = (await loadSettings()).keyOverrides['chordwiki:chart:Test Song']?.usedAt ?? 0;
    expect(stamped).toBeGreaterThan(yesterday);

    (await start(load('chordwiki-basic')))();
    expect((await loadSettings()).keyOverrides['chordwiki:chart:Test Song']?.usedAt).toBe(stamped);
  });
});
