import { type Key, parseKey } from '@/core/key';
import type { ChartItem, SiteAdapter } from '../types';
import { SELECTORS } from './selectors';

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
 */
const PLAYED = /\bPlay\s*[:：]\s*([^\s/]+)/iu;
const WRITTEN = /\bKey\s*[:：]\s*([^\s/]+)/iu;
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

/**
 * An address, or nothing where it is not one.
 *
 * A page can say anything it likes in a `canonical` link, and building a URL
 * out of it throws where it is not one. In a content script an uncaught throw
 * takes the whole run with it, and every chord on the page along with it.
 */
function absolute(href: string | null | undefined, base: URL): URL | null {
  if (!href) return null;
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

export const chordwiki: SiteAdapter = {
  id: 'chordwiki',

  matches(url) {
    const host = url.hostname;
    if (host !== HOST && !host.endsWith(`.${HOST}`)) return false;
    return url.pathname === TRANSPOSED_CHART_PATH || url.pathname.startsWith(CHART_PATH);
  },

  isChordPage(doc) {
    // The same scope the chart is read in. A chord slot the site puts
    // somewhere else on the page does not make the page a chart, and would
    // otherwise say it did while the reading found nothing.
    return doc.querySelector(SELECTORS.chord) !== null;
  },

  readChart(doc) {
    // No wrapper, no chart. Reading the page at large instead would be a
    // chord chart's worth of rewriting let loose on whatever else is on it,
    // the first time the site renames this.
    const chart = doc.querySelector(SELECTORS.chart);
    if (!chart) return [];

    // Document order is guaranteed, which is why the keys and the chords are
    // asked for together rather than separately and put back in step.
    return [...chart.querySelectorAll(SELECTORS.chartItems)].map((element): ChartItem => {
      const text = (element.textContent ?? '').trim();
      if (element.matches(SELECTORS.key)) {
        return { kind: 'key', key: readKeyLine(text), raw: text };
      }
      return { kind: 'chord', node: { element: element as HTMLElement, text } };
    });
  },

  pageId(doc, url) {
    // The site's own address for the chart stays put when the chart is
    // transposed, where the address in the bar does not.
    const canonical = doc.querySelector(SELECTORS.canonical)?.getAttribute('href');
    const openGraph = doc.querySelector(SELECTORS.openGraphUrl)?.getAttribute('content');
    const stated = absolute(canonical || openGraph, url);
    if (stated) return stated.href;

    // Otherwise the same promise has to be kept off the address in the bar,
    // which says how the chart is being shown as well as which chart it is. A
    // chart is named by its title, and the two addresses put the title in
    // different places: in the path, or in a parameter of the one a reader is
    // sent to on transposing. Everything else — the transposition, which
    // accidentals it is being spelled with, where in the page they were — is
    // about the view and not about the chart.
    const title = url.pathname === TRANSPOSED_CHART_PATH && url.searchParams.get(TITLE_PARAM);
    const path = title ? `${CHART_PATH}${encodeURIComponent(title)}` : url.pathname;
    return new URL(path, url).href;
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
