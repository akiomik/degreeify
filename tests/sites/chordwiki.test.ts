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

/**
 * A chart stating one key line and holding one chord.
 *
 * With a chord in it because a chart is found by looking for them: a wrapper
 * with no chord slot anywhere in it is not a chart, whatever else it holds.
 */
const chartStating = (line: string): Document =>
  parse(`
    <div class="main">
      <p class="key">${line}</p>
      <p class="line"><span class="chord">C</span></p>
    </div>
  `);

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
    // The address a chart is transposed to, and not merely something that
    // starts the same way.
    'https://ja.chordwiki.org/wiki.cgi.bak',
    'https://ja.chordwiki.org/wiki.cgix?c=view',
  ];

  it.each(elsewhere)('leaves %s alone', (href) => {
    expect(chordwiki.matches(new URL(href))).toBe(false);
    expect(adapterFor(new URL(href))).toBeNull();
  });

  // An address is not enough: the site serves other things from one.
  it('knows a chart from a page that only looks like one', () => {
    expect(chordwiki.isChordPage(load('chordwiki-basic'))).toBe(true);

    expect(chordwiki.isChordPage(parse('<div class="main"><p>No chart here.</p></div>'))).toBe(
      false,
    );
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

  // A chord slot outside the chart is not part of the chart, and a page with
  // no chart in it is not a chart. Nothing on the site puts a slot outside
  // one today, which is exactly when a guard is cheap: the day the wrapper is
  // renamed, reading the page at large would turn a chord chart's worth of
  // rewriting loose on whatever else is on it.
  it('reads nothing at all from a page with no chart in it', () => {
    const outside = parse(
      '<div class="related"><p class="line"><span class="chord">Bb</span></p></div>',
    );

    expect(chordwiki.isChordPage(outside)).toBe(false);
    expect(chordwiki.readChart(outside)).toEqual([]);
  });

  // The chart is the wrapper with chords in it, not the first wrapper. Taking
  // the first would answer that a page with furniture in one of these is no
  // chart and read nothing from it — which looks exactly like the extension
  // being switched off, and is the kind of failure that goes unnoticed
  // longest.
  it('finds the chart where a page carries more than one wrapper', () => {
    const doc = parse(`
      <div class="main"><p>Something else the site put in one of these.</p></div>
      <div class="main">
        <p class="key">Key: C</p>
        <p class="line"><span class="chord">Am7</span></p>
      </div>
    `);

    expect(chordwiki.isChordPage(doc)).toBe(true);
    expect(keysOf(chordwiki.readChart(doc))).toEqual(['C']);
    expect(chordsOf(chordwiki.readChart(doc))).toEqual(['Am7']);
  });

  it('reads only what is inside the chart', () => {
    const doc = parse(`
      <div class="related"><p class="line"><span class="chord">Bb</span></p></div>
      <div class="main">
        <p class="key">Key: C</p>
        <p class="line"><span class="chord">C</span></p>
      </div>
    `);

    expect(chordsOf(chordwiki.readChart(doc))).toEqual(['C']);
  });

  // What a slot says, rather than how the page happens to have laid it out.
  // The element is what gets rewritten and what the original is restored
  // from; this is for reading, and a caller comparing it against something
  // should not have to know about the site's indentation.
  it('gives a slot without the whitespace around it', () => {
    const doc = parse(
      '<div class="main"><p class="line"><span class="chord">\n  Am7\n</span></p></div>',
    );

    expect(chordsOf(chordwiki.readChart(doc))).toEqual(['Am7']);
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

  // The three shapes are the site's, but the case of the words in them is
  // not something to depend on. Reading one of them regardless of case and
  // the others only as written would leave a shouted line naming nothing.
  // The words are read whatever case they are in. The key itself is not: a
  // note is written in capitals, and `key: c` naming nothing is the note
  // reader's answer rather than an oversight here.
  it.each([
    ['Key: C', 'C'],
    ['KEY: C', 'C'],
    ['key: C', 'C'],
    ['key: c', null],
    ['Original Key: C / Play: F#', 'F#'],
    ['ORIGINAL KEY: C / PLAY: F#', 'F#'],
    ['Original Key: Am / Capo: 5 / Play: Em', 'Em'],
    ['ORIGINAL KEY: AM / CAPO: 5 / PLAY: EM', null],
  ])('reads the words of %j whatever case they are in, giving %s', (line, expected) => {
    expect(keysOf(chordwiki.readChart(chartStating(line)))).toEqual([expected]);
  });

  // The separators come in both widths, and a line written in the wide ones
  // has to end the key name at the wide slash as it does at the narrow.
  it.each([
    ['Original Key: C ／ Play: F#', 'F#'],
    ['Original Key：Am ／ Capo：5 ／ Play：Em', 'Em'],
    ['Play：F#／Capo：3', 'F#'],
  ])('reads %j, written with the wide separators, as %s', (line, expected) => {
    expect(keysOf(chordwiki.readChart(chartStating(line)))).toEqual([expected]);
  });

  // An empty one says nothing, which is not the same as saying something that
  // cannot be read. Passed on as a key with none it would stop the naming
  // until the chart states another, so one stray empty line would cost the
  // rest of the chart.
  it('passes over an empty key line rather than reading it as an unreadable one', () => {
    const doc = parse(`
      <div class="main">
        <p class="key">Key: C</p>
        <p class="line"><span class="chord">Am7</span></p>
        <p class="key"></p>
        <p class="line"><span class="chord">F</span></p>
      </div>
    `);

    expect(keysOf(chordwiki.readChart(doc))).toEqual(['C']);
    expect(nameChart(chordwiki.readChart(doc))).toEqual(['VIm7', 'IV']);
  });

  // A line writes a key with something around it more often than it looks,
  // and what is captured runs to the next space or slash — so the punctuation
  // comes with it and the name is then no name. A key that cannot be read
  // stops the naming for the rest of the section, so a single stray bracket
  // would cost a chart from there on.
  it.each([
    ['Key: C,', 'C'],
    ['Key: C, D', 'C'],
    ['Key: (C)', 'C'],
    ['Key: 「Gm」', 'Gm'],
    ['Key: F#,', 'F#'],
    // Read no further than punctuation. `EM` is `Em` shouted, and nothing
    // here can make a minor key of it — dropping the letter to call it E
    // major would be worse than saying so.
    ['Key: EM', null],
    ['Key: Am7', null],
    // An accidental could have gone on being the name, so leaving one off is
    // reading something other than what is written.
    ['Key: C♭♭♭', null],
    ['Key: Cbbb', null],
    ['Key: C major', 'C'],
  ])('reads the key of %j as %s, punctuation and all', (line, expected) => {
    expect(keysOf(chordwiki.readChart(chartStating(line)))).toEqual([expected]);
  });

  // Each word has to begin where it says it does. A line ending `Display:`
  // holds `play:`, and one beginning `Monkey:` holds `key:` — either read as
  // what it is not takes a section of the chart with it, since a key that
  // could not be read stops the naming until the chart states another.
  it.each([
    ['Key: C / Display: Foo', 'C'],
    ['Monkey: C', null],
  ])('does not find a word inside another in %j', (line, expected) => {
    expect(keysOf(chordwiki.readChart(chartStating(line)))).toEqual([expected]);
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

  // Not knowing and knowing it is untransposed are different answers, and a
  // key kept against the chart untransposed is shifted by this to be shown:
  // shifting by nothing because nothing was known would show a reader a key
  // the chart is not in.
  it('says nothing where the page says nothing', () => {
    expect(chordwiki.transposeOffset(parse('<div class="main"></div>'))).toBeNull();
  });

  // An option written without a value takes its text for one, so reading the
  // attribute would call this nothing at all — a key shifted by nothing,
  // silently.
  it.each([
    ['<option selected>+6</option>', 6],
    ['<option selected>\n  +6\n</option>', 6],
    ['<option selected> -5 </option>', -5],
  ])('reads %j from its text', (option, expected) => {
    expect(
      chordwiki.transposeOffset(parse(`<div id="key"><select name="key">${option}</select></div>`)),
    ).toBe(expected);
  });

  it('reads an option written without a value from its text', () => {
    expect(
      chordwiki.transposeOffset(
        parse('<div id="key"><select name="key"><option selected>+6</option></select></div>'),
      ),
    ).toBe(6);
  });

  // `Number.parseInt` reads as far as it understands and stops, so a control
  // saying something that is not a count of semitones would be read as one.
  it.each(['1e3', '6x', '', '  ', '99', '-99', 'six'])(
    'says nothing where the control says %j',
    (value) => {
      expect(
        chordwiki.transposeOffset(
          parse(
            `<div id="key"><select name="key"><option selected value="${value}">x</option></select></div>`,
          ),
        ),
      ).toBeNull();
    },
  );
});

describe('what a chart is called', () => {
  /** A page stating whichever of the two addresses a site can state. */
  const stating = (links: { canonical?: string; openGraph?: string }): Document =>
    parse(
      [
        links.canonical ? `<link rel="canonical" href="${links.canonical}" />` : '',
        links.openGraph ? `<meta property="og:url" content="${links.openGraph}" />` : '',
        '<div class="main"></div>',
      ].join(''),
    );

  const named = (page: Document, href: string) => chordwiki.pageId(page, new URL(href));

  // The same chart transposed is the same chart. A name that moved when a
  // reader transposed one would lose them the key they had set by hand, at
  // the moment they pressed a button that changed nothing about the song.
  it('does not move when the chart is transposed', () => {
    const url = new URL('https://ja.chordwiki.org/wiki.cgi?c=view&t=Test%20Song&key=6');
    expect(chordwiki.pageId(load('chordwiki-transposed'), url)).toBe(
      chordwiki.pageId(load('chordwiki-basic'), url),
    );
  });

  // Every address a chart is reachable at, from every place an address can
  // come from, has to name it the same. Reconciling them a pair at a time is
  // how they came to disagree about percent-encoding, about the host, and
  // about whether a query is part of a chart's name.
  describe('every address a chart is reachable at', () => {
    const bare = stating({});

    const sameChart: [what: string, id: () => string][] = [
      ['in the path', () => named(bare, 'https://ja.chordwiki.org/wiki/Rock%20%26%20Roll')],
      ['in a parameter', () => named(bare, 'https://ja.chordwiki.org/wiki.cgi?t=Rock+%26+Roll')],
      [
        'with the view mixed in',
        () => named(bare, 'https://ja.chordwiki.org/wiki.cgi?t=Rock+%26+Roll&key=6&symbol=flat'),
      ],
      ['with a fragment', () => named(bare, 'https://ja.chordwiki.org/wiki/Rock%20%26%20Roll#v')],
      [
        "on another of the site's hosts",
        () => named(bare, 'https://www.chordwiki.org/wiki/Rock%20%26%20Roll'),
      ],
      ['on the bare host', () => named(bare, 'https://chordwiki.org/wiki/Rock%20%26%20Roll')],
      [
        'stated by the page',
        () =>
          named(
            stating({ canonical: 'https://ja.chordwiki.org/wiki/Rock%20%26%20Roll' }),
            'https://ja.chordwiki.org/wiki.cgi?t=Something%20Else',
          ),
      ],
      [
        'stated by the page, with the view mixed in',
        () =>
          named(
            stating({ canonical: 'https://ja.chordwiki.org/wiki.cgi?t=Rock+%26+Roll&key=6' }),
            'https://ja.chordwiki.org/wiki.cgi?t=Something%20Else',
          ),
      ],
      [
        'stated the other way',
        () =>
          named(
            stating({ openGraph: 'https://ja.chordwiki.org/wiki/Rock%20%26%20Roll' }),
            'https://ja.chordwiki.org/wiki.cgi?t=Something%20Else',
          ),
      ],
    ];

    it.each(sameChart)('names it the same %s', (_what, id) => {
      expect(id()).toBe(sameChart[0]?.[1]());
    });

    // One decoder for both, because two is what the round before this was.
    // A title is written into an address one way and read out of it another
    // as soon as the two places it can sit are read by different rules —
    // and a broken escape took the name away entirely, host and all.
    const encodings: [what: string, path: string, query: string, title: string][] = [
      ['a space', 'Rock%20Roll', 'Rock+Roll', 'Rock Roll'],
      // Which is how the site writes one: a chart called `SWEET MEMORIES`
      // lives at `/wiki/SWEET+MEMORIES`.
      ['a plus for a space', 'Rock+Roll', 'Rock+Roll', 'Rock Roll'],
      ['an ampersand', 'Rock%20%26%20Roll', 'Rock+%26+Roll', 'Rock & Roll'],
      ['a stray percent sign', '100%', '100%', '100%'],
      ['an escape that is not text', '%C6%FC', '%C6%FC', '\uFFFD\uFFFD'],
      ['a trailing slash', 'Rock%20Roll/', 'Rock+Roll', 'Rock Roll'],
      // Which is the address's and not the title's. Taken off the title
      // instead, a chart whose name really does end in one would lose it here
      // and keep it at the other address.
      ['a slash of its own', 'Rock%20Roll%2F', 'Rock+Roll%2F', 'Rock Roll/'],
    ];

    it.each(encodings)('reads %s the same in either place', (_what, path, query, title) => {
      const inPath = named(bare, `https://ja.chordwiki.org/wiki/${path}`);
      const inParam = named(bare, `https://ja.chordwiki.org/wiki.cgi?t=${query}&key=6`);

      expect(inPath).toBe(inParam);
      expect(inPath).toBe(`chordwiki:${title}`);
    });

    it('names a different chart differently', () => {
      expect(named(bare, 'https://ja.chordwiki.org/wiki/Rock%20%26%20Rolling')).not.toBe(
        named(bare, 'https://ja.chordwiki.org/wiki/Rock%20%26%20Roll'),
      );
    });
  });

  // Which the page states is not the point; whether it names a chart is. A
  // page can put anything it likes in either of them, and picking one before
  // reading it throws away the other.
  describe('an address the page states that names no chart', () => {
    const elsewhere = 'https://ja.chordwiki.org/wiki/Test';

    it.each([
      ['is not an address at all', 'https://['],
      ['is somewhere else entirely', 'https://example.com/wiki/Other'],
      ['is the site, but not a chart', 'https://ja.chordwiki.org/search.cgi?q=x'],
    ])('passes over one that %s', (_what, canonical) => {
      expect(named(stating({ canonical }), elsewhere)).toBe(named(stating({}), elsewhere));
    });

    it('passes over it in favour of the other one, not of the address in the bar', () => {
      const page = stating({
        canonical: 'https://[',
        openGraph: 'https://ja.chordwiki.org/wiki/Test%20Song',
      });

      expect(named(page, elsewhere)).toBe(
        named(stating({}), 'https://ja.chordwiki.org/wiki/Test%20Song'),
      );
    });
  });

  // That address serves more than charts, and all of them name the chart they
  // are about. A page that is not the chart must not claim the chart's
  // settings.
  it.each(['edit', 'history', 'diff'])('does not let a page doing %s claim the chart', (action) => {
    const doing = `https://ja.chordwiki.org/wiki.cgi?c=${action}&t=Test%20Song`;
    const reading = 'https://ja.chordwiki.org/wiki.cgi?c=view&t=Test%20Song';

    expect(chordwiki.matches(new URL(doing))).toBe(false);
    expect(named(stating({}), doing)).not.toBe(named(stating({}), reading));
  });

  // Down to the query, because two pages for editing two charts are one
  // address and two different pages, and settings kept against one of them
  // must not be read back on the other. The fragment goes, being a place in a
  // page rather than a page.
  it('names a page that is no chart after itself, whole', () => {
    const page = stating({});
    const id = named(page, 'https://ja.chordwiki.org/search.cgi?q=x#top');

    expect(id).toBe(named(page, 'https://ja.chordwiki.org/search.cgi?q=x#other'));
    expect(id).not.toBe(named(page, 'https://ja.chordwiki.org/search.cgi?q=y'));
    expect(id).not.toBe(named(page, 'https://ja.chordwiki.org/other.cgi?q=x'));
  });

  // A page for editing a chart states that chart's own address. Reading the
  // stated one before asking whether this page is a chart at all would let it
  // claim the chart's settings by way of a link rather than by being it, and
  // the guard that turns such an address away sits somewhere else entirely.
  it('does not let a page state its way into being a chart', () => {
    const editing = stating({ canonical: 'https://ja.chordwiki.org/wiki/Test%20Song' });
    const reading = stating({});

    const claimed = named(editing, 'https://ja.chordwiki.org/wiki.cgi?c=edit&t=Test+Song');
    expect(claimed).not.toBe(named(reading, 'https://ja.chordwiki.org/wiki/Test%20Song'));
  });

  it('tells two pages that are no charts apart', () => {
    const page = stating({});
    expect(named(page, 'https://ja.chordwiki.org/wiki.cgi?c=edit&t=Song%20A')).not.toBe(
      named(page, 'https://ja.chordwiki.org/wiki.cgi?c=edit&t=Song%20B'),
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
