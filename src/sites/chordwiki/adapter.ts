import { type Key, parseKey } from '@/core/key';
import type { ChartItem, SiteAdapter } from '../types';
import { SELECTORS } from './selectors';

const HOST = 'chordwiki.org';

/** Where a chart lives, and where the site sends the reader on transposing one. */
const CHART_PATHS = ['/wiki/', '/wiki.cgi'];

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
const PLAYED = /Play\s*[:：]\s*([^\s/]+)/u;
const WRITTEN = /Key\s*[:：]\s*([^\s/]+)/u;
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
    return CHART_PATHS.some((path) => url.pathname.startsWith(path));
  },

  isChordPage(doc) {
    return doc.querySelector(SELECTORS.chord) !== null;
  },

  readChart(root) {
    // Document order is guaranteed, which is why the keys and the chords are
    // asked for together rather than separately and put back in step.
    return [...root.querySelectorAll(SELECTORS.chartItems)].map((element): ChartItem => {
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

    const here = new URL(url.href);
    here.hash = '';
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
