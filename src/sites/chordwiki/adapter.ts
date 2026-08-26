import { type Key, parseKey } from '@/core/key';
import type { ChartItem, SiteAdapter } from '../types';
import { SELECTORS } from './selectors';

const HOST = 'chordwiki.org';

/** Where a chart lives. */
const CHART_PATH = '/wiki/';

/** Where the site sends a reader who transposes one. */
const TRANSPOSED_CHART_PATH = '/wiki.cgi';

/**
 * What the address says about how a chart is being shown rather than about
 * which chart it is: how far it has been transposed, and whether the site is
 * spelling it with sharps or with flats.
 */
const VIEWING_PARAMS = ['key', 'symbol'];

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
 */
const PLAYED = /Play\s*[:：]\s*([^\s/]+)/iu;
const WRITTEN = /Key\s*[:：]\s*([^\s/]+)/iu;
const TRANSPOSED = /Original\s+Key\s*[:：]/iu;

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

export const chordwiki: SiteAdapter = {
  id: 'chordwiki',

  matches(url) {
    const host = url.hostname;
    if (host !== HOST && !host.endsWith(`.${HOST}`)) return false;
    return url.pathname === TRANSPOSED_CHART_PATH || url.pathname.startsWith(CHART_PATH);
  },

  isChordPage(doc) {
    return doc.querySelector(SELECTORS.chord) !== null;
  },

  readChart(root) {
    // Scoped to the chart, so that a chord slot anywhere else on the page —
    // a related-songs list, whatever the site adds next — is not read as part
    // of it. Falling back to what was handed over covers a caller that has
    // already narrowed it down.
    const chart = root.querySelector(SELECTORS.chart) ?? root;

    // Document order is guaranteed, which is why the keys and the chords are
    // asked for together rather than separately and put back in step.
    return [...chart.querySelectorAll(SELECTORS.chartItems)].map((element): ChartItem => {
      const text = element.textContent ?? '';
      if (element.matches(SELECTORS.key)) {
        return { kind: 'key', key: readKeyLine(text), raw: text };
      }
      return { kind: 'chord', node: { element: element as HTMLElement, text } };
    });
  },

  pageId(doc, url) {
    const canonical = doc.querySelector(SELECTORS.canonical)?.getAttribute('href');
    const openGraph = doc.querySelector(SELECTORS.openGraphUrl)?.getAttribute('content');

    // The site's own address for the chart stays put when the chart is
    // transposed, where the address in the bar does not. Falling back to the
    // latter costs a reader their settings on transposing, which is better
    // than having nowhere to keep them.
    const stated = canonical || openGraph;
    if (stated) return new URL(stated, url).href;

    // Off what is in the bar, which does move when a chart is transposed: the
    // fragment is a place in the page and the viewing parameters are how it
    // is being shown, and neither says which chart this is.
    const here = new URL(url.href);
    here.hash = '';
    for (const param of VIEWING_PARAMS) here.searchParams.delete(param);
    return here.href;
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
    return Number.isFinite(offset) ? offset : 0;
  },
};
