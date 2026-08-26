// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseChord } from '@/core/chord';
import { toDegreeChord } from '@/core/degree';
import { formatKey, inferKey, type Key } from '@/core/key';
import { formatDegreeChord } from '@/core/notation';
import { chordwiki } from '@/sites/chordwiki/adapter';
import { adapterFor } from '@/sites/registry';
import type { ChartItem } from '@/sites/types';

const FIXTURES = join(import.meta.dirname, '../fixtures');

/** Parses a fixture, the way a page arrives at a content script: as a document. */
const load = (name: string): Document =>
  parse(readFileSync(join(FIXTURES, `${name}.html`), 'utf8'));

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

const chartOf = (name: string): ChartItem[] => chordwiki.readChart(load(name));

const chordsOf = (items: readonly ChartItem[]): string[] =>
  items.filter((item) => item.kind === 'chord').map((item) => item.node.text);

const keysOf = (items: readonly ChartItem[]): (string | null)[] =>
  items.filter((item) => item.kind === 'key').map((item) => item.key && formatKey(item.key));

/**
 * The chart as it would be shown: every chord named against the key in force
 * where it sits, and everything that is not a chord left alone.
 *
 * This is the fold the content script does, written out here because it is
 * what the adapter's output is for and the only way to see whether the order
 * it returns things in is any use.
 */
const nameChart = (items: readonly ChartItem[], opening: Key | null = null): string[] => {
  let current = opening;
  const named: string[] = [];

  for (const item of items) {
    if (item.kind === 'key') {
      // Deliberately including the unreadable ones: a chart that stops saying
      // what key it is in has stopped, and carrying the last one forward
      // would name a whole section against a tonic that is not there.
      current = item.key;
      continue;
    }

    const chord = parseChord(item.node.text);
    named.push(
      chord && current ? formatDegreeChord(toDegreeChord(chord, current)) : item.node.text,
    );
  }

  return named;
};

describe('matching a page', () => {
  const charts = [
    'https://ja.chordwiki.org/wiki/Test%20Song',
    'https://www.chordwiki.org/wiki/Test%20Song',
    'https://chordwiki.org/wiki/Test%20Song',
    // Where the site sends a reader who transposes a chart.
    'https://ja.chordwiki.org/wiki.cgi?c=view&t=Test%20Song&key=6',
  ];

  it.each(charts)('takes %s', (href) => {
    expect(chordwiki.matches(new URL(href))).toBe(true);
    expect(adapterFor(new URL(href))).toBe(chordwiki);
  });

  const elsewhere = [
    'https://ja.chordwiki.org/',
    'https://ja.chordwiki.org/search.cgi?q=test',
    'https://chordwiki.org.example.com/wiki/Test',
    'https://example.com/wiki/Test',
  ];

  it.each(elsewhere)('leaves %s alone', (href) => {
    expect(chordwiki.matches(new URL(href))).toBe(false);
    expect(adapterFor(new URL(href))).toBeNull();
  });

  // An address is not enough: the site serves other things from one.
  it('knows a chart from a page that only looks like one', () => {
    expect(chordwiki.isChordPage(load('chordwiki-basic'))).toBe(true);

    document.documentElement.innerHTML =
      '<body><div class="main"><p>No chart here.</p></div></body>';
    expect(chordwiki.isChordPage(document)).toBe(false);
  });
});

describe('reading a chart', () => {
  it('returns the chords in the order they are written', () => {
    expect(chordsOf(chartOf('chordwiki-basic'))).toEqual([
      'C',
      'Am7',
      'FM7(#11)',
      'G7-9',
      'Dm7/G',
      'N.C.',
      '',
      'Ebim',
    ]);
  });

  it('returns the keys with them, in the same sequence', () => {
    const items = chartOf('chordwiki-modulation');
    expect(keysOf(items)).toEqual(['Gm', 'Em', 'Em']);
    expect(items.filter((item) => item.kind === 'chord')).toHaveLength(11);
  });

  it('hands back the element each chord sits in, which is what gets rewritten', () => {
    const items = chartOf('chordwiki-basic');
    const first = items.find((item) => item.kind === 'chord');

    expect(first?.node.element.className).toBe('chord');
    expect(first?.node.element.textContent).toBe(first?.node.text);
  });
});

describe('the stated key', () => {
  it('reads a chart that states one', () => {
    expect(keysOf(chartOf('chordwiki-basic'))).toEqual(['C']);
  });

  // A transposed chart states the key it was written in as well as the one on
  // the page, and the written one comes first. Reading that would name every
  // chord against a tonic that is not there.
  it('reads what is being played and not what it was written in', () => {
    expect(keysOf(chartOf('chordwiki-transposed'))).toEqual(['F#']);
  });

  // Transposed downwards the site offers a capo, which puts a third field in
  // the line. The capo is where to put a capo and not a key.
  it('reads past a capo', () => {
    expect(keysOf(chartOf('chordwiki-capo'))).toEqual(['Em']);
  });

  it('has none to read where the chart states none', () => {
    expect(keysOf(chartOf('chordwiki-no-key'))).toEqual([]);
  });
});

describe('how far the chart has been transposed', () => {
  const offsets: [fixture: string, offset: number][] = [
    ['chordwiki-basic', 0],
    ['chordwiki-transposed', 6],
    ['chordwiki-capo', -5],
    ['chordwiki-no-key', 0],
  ];

  it.each(offsets)('reads %s as %i', (fixture, offset) => {
    expect(chordwiki.transposeOffset(load(fixture))).toBe(offset);
  });

  it('reads nothing as nothing', () => {
    expect(chordwiki.transposeOffset(parse('<div class="main"></div>'))).toBe(0);
  });
});

describe('what a chart is called', () => {
  const url = new URL('https://ja.chordwiki.org/wiki.cgi?c=view&t=Test%20Song&key=6');

  // The same chart transposed is the same chart. A name that moved when a
  // reader transposed one would lose them the key they had set by hand, at
  // the moment they pressed a button that changed nothing about the song.
  it('does not move when the chart is transposed', () => {
    const written = chordwiki.pageId(load('chordwiki-basic'), url);
    const transposed = chordwiki.pageId(load('chordwiki-transposed'), url);
    expect(transposed).toBe(written);
  });

  it('falls back to the address in the bar, without its fragment', () => {
    const bare = new URL('https://ja.chordwiki.org/wiki/Test#verse');
    expect(chordwiki.pageId(parse('<div class="main"></div>'), bare)).toBe(
      'https://ja.chordwiki.org/wiki/Test',
    );
  });
});

describe('naming a whole chart', () => {
  it('names the chords of a chart in the key it states', () => {
    expect(nameChart(chartOf('chordwiki-basic'))).toEqual([
      'I',
      'VIm7',
      'IVM7(#11)',
      'V7-9',
      'IIm7/V',
      'N.C.',
      '',
      'bIIIim',
    ]);
  });

  // The keys and the chords come back in one sequence, so which chords fall
  // under which key needs no reconstructing — this is the whole of the fold.
  it('changes key where the chart changes key', () => {
    expect(nameChart(chartOf('chordwiki-modulation'))).toEqual([
      // Before the chart has said anything.
      'Gm',
      // Key: Gm
      'Im',
      'IVm7',
      'bVI',
      'V7',
      // Key: Em
      'Im7',
      'IVm7',
      'bVIM7',
      'V7',
      // Original Key: Am / Capo: 5 / Play: Em
      'Im',
      'bVII',
    ]);
  });

  it('leaves alone everything in a chord slot that is not a chord', () => {
    expect(nameChart(chartOf('chordwiki-tokens'))).toEqual([
      '|',
      '>',
      '＞',
      '(3連)',
      '(2拍3連)',
      'N.C.',
      '',
      '(IIIm7)',
      'VI5/III',
      'IVM7(#11)',
    ]);
  });
});

describe('a chart that states no key', () => {
  // Which is a real thing charts do, and this one does not say enough for a
  // key to be worked out either. Leaving it in chord names is the answer.
  it('is left to inference, which declines', () => {
    const items = chartOf('chordwiki-no-key');
    const chords = chordsOf(items)
      .map(parseChord)
      .filter((chord) => chord !== null);

    expect(inferKey(chords)).toBeNull();
    expect(nameChart(items)).toEqual(chordsOf(items));
  });
});
