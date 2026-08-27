import { type Key, parseKey } from '@/core/key';
import type { ChartItem, SiteAdapter } from '../types';
import { SELECTORS } from './selectors';

const ID = 'chordwiki';

const HOST = 'chordwiki.org';

/** Where a chart lives. */
const CHART_PATH = '/wiki/';

/** Where the site sends a reader who transposes one. */
const TRANSPOSED_CHART_PATH = '/wiki.cgi';

/** Where the address of a transposed chart keeps the chart's title. */
const TITLE_PARAM = 't';

/**
 * What the page is being played in, which on a transposed chart is not what
 * it was written in.
 *
 * The line comes in three shapes, and the last two both hold the first:
 *
 *     Key: Gm
 *     Original Key: F# / Play: C
 *     Original Key: Gm / Capo: 5 / Play: Dm
 *
 * So `Play:` has to be looked for first. Reading `Key:` off a transposed
 * chart takes the key it was written in and names every chord on the page
 * against a tonic that is not there. The capo is where to put a capo and not
 * a key, and is no business of a degree name.
 *
 * Each word has to begin where it says it does. A line ending `Display: Foo`
 * holds `play:` and a line beginning `Monkey:` holds `key:`, and either read
 * as what it is not takes a section of the chart with it.
 *
 * The separators come in both widths — a Japanese keyboard gives the wide
 * ones as readily as the narrow — so the key name ends at either.
 */
const PLAYED = /\bPlay\s*[:：]\s*([^\s/／]+)/iu;
const WRITTEN = /\bKey\s*[:：]\s*([^\s/／]+)/iu;
const TRANSPOSED = /\bOriginal\s+Key\s*[:：]/iu;

function readKeyLine(text: string): Key | null {
  const played = PLAYED.exec(text)?.[1];
  if (played) return parseKey(played);

  // A line that names what the chart was written in without naming what is
  // being played is a shape nothing here has seen. The key it does name is
  // not the one the chords are in, so the honest answer is that this section
  // no longer says.
  if (TRANSPOSED.test(text)) return null;

  const written = WRITTEN.exec(text)?.[1];
  return written ? parseKey(written) : null;
}

/** An address, or nothing where the text is not one. */
function absolute(href: string | null | undefined, base: URL): URL | null {
  if (!href) return null;
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

/** Text with its percent-encoding undone, or nothing where that is not possible. */
function decoded(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

function isChartAddress(url: URL): boolean {
  const host = url.hostname;
  if (host !== HOST && !host.endsWith(`.${HOST}`)) return false;
  return url.pathname === TRANSPOSED_CHART_PATH || url.pathname.startsWith(CHART_PATH);
}

/**
 * The chart an address names, or nothing where it names none.
 *
 * The title, and only the title. A chart is reachable at more than one
 * address — in the path, or in a parameter of the one a reader is sent to on
 * transposing, on any of the site's hosts, with or without the parameters
 * saying how far it has been transposed and which accidentals it is being
 * spelled with — and all of those are the same chart. What is left once the
 * title is taken out of them is about the view.
 *
 * Every address goes through here, wherever it came from, which is the point.
 * Reconciling the paths one pair at a time is how they came to disagree about
 * percent-encoding, about the host, and about whether a query is part of a
 * chart's name: three answers to a question that has one.
 */
function chartNamed(url: URL): string | null {
  if (!isChartAddress(url)) return null;

  if (url.pathname === TRANSPOSED_CHART_PATH) return url.searchParams.get(TITLE_PARAM);
  return decoded(url.pathname.slice(CHART_PATH.length));
}

export const chordwiki: SiteAdapter = {
  id: ID,

  matches: isChartAddress,

  isChordPage(doc) {
    return doc.querySelector(SELECTORS.chart)?.querySelector(SELECTORS.chord) != null;
  },

  readChart(doc) {
    // No wrapper, no chart. Reading the page at large instead would be a
    // chord chart's worth of rewriting let loose on whatever else is on it,
    // the first time the site renames this.
    //
    // The one element, rather than the selector, so that this and the
    // question of whether the page is a chart at all cannot answer about
    // different parts of it — which they would the moment a page carried two
    // of these.
    const chart = doc.querySelector(SELECTORS.chart);
    if (!chart) return [];

    // Document order is guaranteed, which is why the keys and the chords are
    // asked for together rather than separately and put back in step.
    const items: ChartItem[] = [];
    for (const element of chart.querySelectorAll(SELECTORS.chartItems)) {
      const text = (element.textContent ?? '').trim();

      if (!element.matches(SELECTORS.key)) {
        items.push({ kind: 'chord', node: { element: element as HTMLElement, text } });
        continue;
      }

      // An empty one says nothing, which is not the same as saying something
      // that cannot be read. Passing it on as a key with none would stop the
      // naming until the chart states another, so one stray empty line would
      // cost the rest of the chart.
      if (text) items.push({ kind: 'key', key: readKeyLine(text), raw: text });
    }

    return items;
  },

  pageId(doc, url) {
    // The site's own address for the chart first, since it is the site
    // saying which chart this is; then the one in the bar, which says that
    // too but with the view mixed in. All of them are read the same way, and
    // one that names no chart on this site — a link to somewhere else, or an
    // address that is not one — is passed over rather than believed.
    const stated = [
      doc.querySelector(SELECTORS.canonical)?.getAttribute('href'),
      doc.querySelector(SELECTORS.openGraphUrl)?.getAttribute('content'),
      url.href,
    ];

    for (const href of stated) {
      const address = absolute(href, url);
      const title = address && chartNamed(address);
      if (title) return `${ID}:${title}`;
    }

    // Nothing on the page named a chart, so this is not one. Whatever it is,
    // it is at least itself, and settings kept against it stay put.
    return `${ID}:${url.origin}${url.pathname}`;
  },

  transposeOffset(doc) {
    // Read from the attribute rather than from the control's value. The page
    // arrives with the option marked, and changing the control submits the
    // form — so what the page states is what is being shown, and there is no
    // moment at which a reader has moved it and the page has not caught up.
    //
    // It is also the only reading that does not depend on the DOM agreeing
    // about `selectedIndex`, which happy-dom does not: given this markup it
    // reports the option before the marked one.
    const marked = doc.querySelector(SELECTORS.transposeSelected);
    const offset = Number.parseInt(marked?.getAttribute('value') ?? '', 10);

    // Nothing, rather than none: a page with no such control, or one whose
    // marked option says nothing, has not told us the chart is untransposed —
    // it has told us nothing, and a caller shifting a key by this had better
    // know which it is looking at.
    return Number.isFinite(offset) ? offset : null;
  },
};
