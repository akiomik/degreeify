/**
 * Every selector ChordWiki is read through, in one place.
 *
 * A site can change its markup at any time, and when it does this is the file
 * that is wrong. Keeping them together is also what makes it possible to say
 * what the adapter depends on without reading it.
 */
/** The wrapper the chart sits in, which everything read out of it hangs off. */
const CHART = 'div.main';

/** Chord slots, and stated keys, as found within the chart. */
const CHORD = 'p.line span.chord';
const KEY = 'p.key';

/** The control a reader transposes a chart with. */
const TRANSPOSE = '#key select[name="key"]';

export const SELECTORS = {
  /** The wrapper the chart itself sits in. Its parent has neither id nor class. */
  chart: CHART,

  /**
   * Chord slots, relative to the chart element and never to the document: a
   * slot the site puts elsewhere on the page is not part of the chart, and
   * this said so by carrying the wrapper until the wrapper became an element
   * resolved once and asked directly.
   */
  chord: CHORD,

  /** A stated key, of which a chart may have none, one, or one per section. */
  key: KEY,

  /**
   * Both of the above at once, which is how they are read: in document order,
   * so that which chords fall under which key needs no reconstructing.
   *
   * Built from them rather than restating them. Written out again, the day
   * the site renames a chord slot and only the first is updated, the chart
   * would still be found and read — and come back with its keys and none of
   * its chords, which is every chord on the page left unnamed and no error
   * anywhere to say so.
   */
  chartItems: `${KEY}, ${CHORD}`,

  /**
   * Named for what the next one is built from, and because a reader wanting
   * to know what this file depends on should find the control here.
   */
  transpose: TRANSPOSE,

  /** The option that control arrived with, which is how far the chart has been transposed. */
  transposeSelected: `${TRANSPOSE} option[selected]`,

  /** The address the site considers this chart to live at, transposed or not. */
  canonical: 'link[rel="canonical"]',
  openGraphUrl: 'meta[property="og:url"]',
} as const;
