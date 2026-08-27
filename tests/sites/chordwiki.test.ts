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
  // A selector matches on names and attributes, which a document that is not
  // HTML carries as readily as one that is — and its elements are not
  // `HTMLElement`s. The content script is matched by address rather than by
  // content type, so such a document reaches this adapter; asserting the type
  // instead of asking it would put nothing wrong here and something wrong far
  // away, in whichever caller first reached for `style` to hold a column
  // still.
  it('reads no chords out of a document that is not HTML', () => {
    const feed = new DOMParser().parseFromString(
      '<div class="main"><p class="line"><span class="chord">C</span></p></div>',
      'text/xml',
    );

    // The selectors do match, which is what makes the answer worth pinning.
    expect(feed.querySelectorAll('div.main p.line span.chord')).toHaveLength(1);
    expect(chordwiki.readChart(feed)).toEqual([]);
  });

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
    // Whether a chart can be named must not turn on whether somebody typed a
    // space. What stops a name is the character it was stopped at, and not
    // whatever else is left on the line.
    ['Key: C,D', 'C'],
    ['Key: C(=Am)', 'C'],
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

  // More than one is not valid markup, and where a page writes more than one
  // a browser shows the last. Reading the first would report a transposition
  // nobody is looking at, and shift a key to somewhere the chart is not.
  it('reads the last marked option, as a browser does', () => {
    const doc = parse(
      '<div id="key"><select name="key"><option value="0" selected>0</option><option value="6" selected>+6</option></select></div>',
    );

    expect(chordwiki.transposeOffset(doc)).toBe(6);
    expect(chordwiki.transposeOffset(doc)).toBe(
      Number(doc.querySelector<HTMLSelectElement>('select')?.value),
    );
  });

  // The site's control sits above the chart, and what follows it is the chart
  // body — written by whoever wrote the chart. A control planted there is one
  // reader's text, and reading it would let a chart shift the key a reader
  // set by hand to somewhere the chart is not. The same threat the name of a
  // chart is held against, on the one reading that was open to it.
  it("reads the site's control and not one planted in the chart", () => {
    const doc = parse(`
      <div id="key"><select name="key"><option value="0" selected>0</option></select></div>
      <div class="main">
        <div id="key"><select name="key"><option value="7" selected>+7</option></select></div>
      </div>
    `);

    expect(chordwiki.transposeOffset(doc)).toBe(0);
  });

  // Told apart by where it is and not by which came first. A page carrying no
  // control of the site's — another template, a print view, the markup
  // changing — would otherwise leave the first on the page being whatever the
  // chart body holds, and the reading meant to be closed to a chart would be
  // open again on a page nobody was looking at.
  it('says nothing where the only control is one planted in the chart', () => {
    const doc = parse(`
      <div class="main">
        <div id="key"><select name="key"><option value="7" selected>+7</option></select></div>
      </div>
    `);

    expect(chordwiki.transposeOffset(doc)).toBeNull();
  });

  // A page may carry the form more than once — one control laid out for a
  // narrow window and one for a wide one is ordinary — and only the copy
  // being shown need arrive marked. Both are the site's, so the one that says
  // something is the one to take: stopping at the first would report nothing
  // about a chart that has plainly been transposed.
  it('reads the first control that says how far the chart has moved', () => {
    const doc = parse(`
      <div id="key"><select name="key"><option value="0">0</option></select></div>
      <div id="key"><select name="key"><option value="6" selected>+6</option></select></div>
      <div class="main"></div>
    `);

    expect(chordwiki.transposeOffset(doc)).toBe(6);
  });

  // Including where the first says something that cannot be read. A control
  // saying nothing this understands has told us nothing, and another copy of
  // the same form may yet say it.
  it('passes over a control whose marked option cannot be read', () => {
    const doc = parse(`
      <div id="key"><select name="key"><option value="six" selected>+6</option></select></div>
      <div id="key"><select name="key"><option value="6" selected>+6</option></select></div>
      <div class="main"></div>
    `);

    expect(chordwiki.transposeOffset(doc)).toBe(6);
  });

  // The same, where the chart body comes first. Neither order is the site's
  // to promise.
  it("reads the site's control where the chart body precedes it", () => {
    const doc = parse(`
      <div class="main">
        <div id="key"><select name="key"><option value="7" selected>+7</option></select></div>
      </div>
      <div id="key"><select name="key"><option value="-5" selected>-5</option></select></div>
    `);

    expect(chordwiki.transposeOffset(doc)).toBe(-5);
  });

  // A control that marks none of its options has not said how far the chart
  // in front of it has been transposed. Its first option is what it would
  // send, which is a different question — and on this site a different
  // answer: the options run from `+6` down to `-5`, so reading the first
  // would answer six for every untransposed chart and shift a reader's key
  // by a tritone. Written in the site's own order so that reading the first
  // is wrong here in the way it would be wrong on a real page.
  it('says nothing where the control marks none of its options', () => {
    const options = [6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5]
      .map((value) => `<option value="${value}">${value}</option>`)
      .join('');

    expect(
      chordwiki.transposeOffset(
        parse(`<div id="key"><select name="key">${options}</select></div>`),
      ),
    ).toBeNull();
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
  // An octave is a transposition the control could offer and the chart it
  // gives back is the chart, so it is one of the things a page can say.
  it.each([
    ['12', 12],
    ['-12', -12],
    ['11', 11],
    ['0', 0],
  ])('reads a transposition of %j semitones', (value, expected) => {
    expect(
      chordwiki.transposeOffset(
        parse(
          `<div id="key"><select name="key"><option selected value="${value}">x</option></select></div>`,
        ),
      ),
    ).toBe(expected);
  });

  it.each(['1e3', '6x', '', '  ', '13', '-13', '99', 'six'])(
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
  /**
   * A page stating whichever of the two addresses a site can state.
   *
   * Written out as a whole document, head and all, because that is where a
   * site states one and because this parser will not put a stray link there
   * on its own — a fragment beginning with one lands in the body, which is
   * exactly the place a stated address does not count.
   */
  const stating = (links: { canonical?: string; openGraph?: string }): Document =>
    parse(`
      <html>
        <head>
          ${links.canonical ? `<link rel="canonical" href="${links.canonical}" />` : ''}
          ${links.openGraph ? `<meta property="og:url" content="${links.openGraph}" />` : ''}
        </head>
        <body><div class="main"></div></body>
      </html>
    `);

  const named = (page: Document, href: string) => chordwiki.pageId(page, new URL(href));

  /** A page stating no address of its own, leaving only the one it is at. */
  const bare = stating({});

  // The same chart transposed is the same chart. A name that moved when a
  // reader transposed one would lose them the key they had set by hand, at
  // the moment they pressed a button that changed nothing about the song.
  //
  // Each page at the address a reader would be at when looking at it, rather
  // than both at one address. Handed the same address twice this passes for a
  // name taken from the address bar alone — which is the drift it is here to
  // catch.
  it('does not move when the chart is transposed', () => {
    expect(
      chordwiki.pageId(
        load('chordwiki-transposed'),
        new URL('https://ja.chordwiki.org/wiki.cgi?c=view&t=Test%20Song&key=6'),
      ),
    ).toBe(
      chordwiki.pageId(
        load('chordwiki-basic'),
        new URL('https://ja.chordwiki.org/wiki/Test%20Song'),
      ),
    );
  });

  // The content script is matched by address, and an address says nothing
  // about what will come back from it. A feed or an XML resource under a
  // matching address is a document with no head at all, and reaching through
  // one throws — which is not one page misread but the script stopping on
  // that page.
  it('names a document that is not HTML rather than throwing', () => {
    const feed = new DOMParser().parseFromString('<rss><channel /></rss>', 'text/xml');
    expect(feed.head).toBeNull();
    expect(chordwiki.pageId(feed, new URL('https://ja.chordwiki.org/wiki/Test%20Song'))).toBe(
      'chordwiki:chart:Test Song',
    );
  });

  // A path is normalised before this ever sees it: `.` and `..` are segments
  // an address is made of, and they come off in the parser, encoded or not.
  // So a title that is nothing but dots cannot be carried in a path — not a
  // pair of addresses disagreeing, but one address unable to say it. The
  // parameter says it, and the site's own stated address, being a path, is
  // passed over the way any address that names no chart is.
  describe('a title a path cannot carry', () => {
    it('reads it from the parameter', () => {
      expect(named(bare, 'https://ja.chordwiki.org/wiki.cgi?c=view&t=.')).toBe('chordwiki:chart:.');
    });

    it('still reads it where the page states the path the site would', () => {
      expect(
        named(
          stating({ canonical: 'https://ja.chordwiki.org/wiki/.' }),
          'https://ja.chordwiki.org/wiki.cgi?c=view&t=.',
        ),
      ).toBe('chordwiki:chart:.');
    });

    it('names the address itself where that is all there is', () => {
      expect(named(bare, 'https://ja.chordwiki.org/wiki/.')).toBe(
        'chordwiki:page:https://ja.chordwiki.org/wiki/',
      );
    });

    // Only a whole segment of dots. A title that merely contains them, or one
    // that spells a slash, comes through as written.
    it.each([
      ['https://ja.chordwiki.org/wiki/%2E%2E%2E', 'chordwiki:chart:...'],
      ['https://ja.chordwiki.org/wiki/a%2F..%2Fb', 'chordwiki:chart:a/../b'],
    ])('carries %s', (href, id) => {
      expect(named(bare, href)).toBe(id);
    });
  });

  // Every address a chart is reachable at, from every place an address can
  // come from, has to name it the same. Reconciling them a pair at a time is
  // how they came to disagree about percent-encoding, about the host, and
  // about whether a query is part of a chart's name.
  describe('every address a chart is reachable at', () => {
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
    // What is expected is the whole name and not only the title, because a
    // title that cannot be read is not named the same way as one that can:
    // `%FC` is a title somebody can type, and it is not the title an address
    // spelling `%FC` is failing to say.
    const encodings: [what: string, path: string, query: string, name: string][] = [
      ['a space', 'Rock%20Roll', 'Rock+Roll', 'chart:Rock Roll'],
      // Which is how the site writes one: a chart called `SWEET MEMORIES`
      // lives at `/wiki/SWEET+MEMORIES`.
      ['a plus for a space', 'Rock+Roll', 'Rock+Roll', 'chart:Rock Roll'],
      ['an ampersand', 'Rock%20%26%20Roll', 'Rock+%26+Roll', 'chart:Rock & Roll'],
      ['a stray percent sign', '100%', '100%', 'chart:100%'],
      // A slash on the end of either spelling, which is the address's. Written
      // out on both sides on purpose: with one side spelling the title
      // without it, the pair passes whether or not the other side takes it
      // off, and stripping it in one place only is how a chart gets two
      // names.
      ['a trailing slash', 'Rock%20Roll/', 'Rock+Roll/', 'chart:Rock Roll'],
      // Which is the address's and not the title's. Taken off the title
      // instead, a chart whose name really does end in one would lose it here
      // and keep it at the other address.
      ['a slash of its own', 'Rock%20Roll%2F', 'Rock+Roll%2F', 'chart:Rock Roll/'],
      // An escape that is not text decodes to the same character whatever it
      // was, so decoding one is how two charts come to share a name. Where
      // that happens the title is kept unread instead: unreadable, and still
      // two charts.
      ['an escape kept unread', '%C6%FC', '%C6%FC', 'unread:%C6%FC'],
      // And kept unread the one way. The two places a title sits do not
      // spell it the same, so what is left when it cannot be read is not the
      // same either — a space and an ampersand are written one way in a path
      // and another in a parameter.
      ['an unread title with a space', '%C6%FC%20Rock', '%C6%FC+Rock', 'unread:%C6%FC%20Rock'],
      ['an unread title with an ampersand', 'Rock&%FC', 'Rock%26%FC', 'unread:Rock%26%FC'],
      // The escaping routines disagree about these, and disagreeing is how one
      // chart gets two names.
      ['an unread title with a bracket', '(%FC', '%28%FC', 'unread:%28%FC'],
      ['an unread title with a tilde', '~%FC', '%7E%FC', 'unread:%7E%FC'],
      // The character a decoder stands in with is one a title may hold, and
      // an address spelling it properly is saying it rather than failing to.
      // Only where more come back than were written is something being stood
      // in for.
      ['a replacement character of its own', '%EF%BF%BD', '%EF%BF%BD', 'chart:\uFFFD'],
      ['one written and one stood in for', '%EF%BF%BD%FC', '%EF%BF%BD%FC', 'unread:%EF%BF%BD%FC'],
    ];

    it.each(encodings)('reads %s the same in either place', (_what, path, query, name) => {
      const inPath = named(bare, `https://ja.chordwiki.org/wiki/${path}`);
      const inParam = named(bare, `https://ja.chordwiki.org/wiki.cgi?t=${query}&key=6`);

      expect(inPath).toBe(inParam);
      expect(inPath).toBe(`chordwiki:${name}`);
    });

    // A title that could not be read is spelled with the same characters a
    // title that could be read may contain, so the two have to be told apart
    // by something other than how they look.
    it('does not let a title it can read stand in for one it cannot', () => {
      expect(named(bare, 'https://ja.chordwiki.org/wiki/%25FC')).not.toBe(
        named(bare, 'https://ja.chordwiki.org/wiki/%FC'),
      );
    });

    it('names a different chart differently', () => {
      expect(named(bare, 'https://ja.chordwiki.org/wiki/Rock%20%26%20Rolling')).not.toBe(
        named(bare, 'https://ja.chordwiki.org/wiki/Rock%20%26%20Roll'),
      );
    });

    // A `rel` is a list of words and the words are not case-sensitive, so
    // these are all this link. Missing one is not nothing: the name falls
    // back to the address the chart was reached at, which moves when the
    // chart is transposed — the drift this whole section is about.
    it.each(['canonical', 'Canonical', 'CANONICAL', 'canonical alternate', 'alternate canonical'])(
      'takes the site at its word where the link says rel=%j',
      (rel) => {
        const page = parse(`
          <html>
            <head><link rel="${rel}" href="https://ja.chordwiki.org/wiki/Rock%20Roll" /></head>
            <body><div class="main"></div></body>
          </html>
        `);

        expect(named(page, 'https://ja.chordwiki.org/wiki/Somewhere%20Else')).toBe(
          'chordwiki:chart:Rock Roll',
        );
      },
    );

    // Said the other way, and matched without regard to case for the same
    // reason: missing it drops the name back onto the address.
    it.each(['og:url', 'OG:URL', 'og:URL'])(
      'takes the site at its word where the meta says property=%j',
      (property) => {
        const page = parse(`
          <html>
            <head><meta property="${property}" content="https://ja.chordwiki.org/wiki/Rock%20Roll" /></head>
            <body><div class="main"></div></body>
          </html>
        `);

        expect(named(page, 'https://ja.chordwiki.org/wiki/Somewhere%20Else')).toBe(
          'chordwiki:chart:Rock Roll',
        );
      },
    );

    // Including two whose addresses cannot be read. Decoding them would make
    // them one name and one set of settings.
    it('names two charts it cannot read differently', () => {
      expect(named(bare, 'https://ja.chordwiki.org/wiki/%C6%FC')).not.toBe(
        named(bare, 'https://ja.chordwiki.org/wiki/%C7%FD'),
      );
    });

    // A title is whatever somebody typed, and on a wiki a page titled with
    // another page's address is a page anybody can make. Which of the two a
    // name is has to be part of the name.
    it('does not let a title stand in for an address', () => {
      const asTitle = named(
        bare,
        'https://ja.chordwiki.org/wiki/https%3A%2F%2Fja.chordwiki.org%2Fsearch.cgi%3Fq%3Dx',
      );
      const asAddress = named(bare, 'https://ja.chordwiki.org/search.cgi?q=x');

      expect(asTitle).not.toBe(asAddress);
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

  // The chart body is written by whoever wrote the chart. A link in it is one
  // reader's text and not the site's word for where this chart lives, and
  // taking it as the site's would let one chart put its name on another
  // chart's settings — on a wiki, by editing a page.
  it('does not let a chart claim another chart by writing a link into itself', () => {
    const injected = parse(`
      <html><body>
        <div class="main">
          <p class="line"><span class="chord">C</span></p>
          <link rel="canonical" href="https://ja.chordwiki.org/wiki/Victim" />
          <meta property="og:url" content="https://ja.chordwiki.org/wiki/Victim" />
        </div>
      </body></html>
    `);

    expect(named(injected, 'https://ja.chordwiki.org/wiki/Attacker')).toBe(
      'chordwiki:chart:Attacker',
    );
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
