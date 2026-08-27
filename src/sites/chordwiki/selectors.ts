/**
 * Every selector ChordWiki is read through, in one place.
 *
 * A site can change its markup at any time, and when it does this is the file
 * that is wrong. Keeping them together is also what makes it possible to say
 * what the adapter depends on without reading it.
 */
/** The wrapper the chart sits in, which everything read out of it hangs off. */
const CHART = 'div.main';

/** The control a reader transposes a chart with. */
const TRANSPOSE = '#key select[name="key"]';

export const SELECTORS = {
  /** The wrapper the chart itself sits in. Its parent has neither id nor class. */
  chart: CHART,

  /**
   * Chord slots, as found within the chart. Not every one holds a chord —
   * see the chord parser.
   */
  chord: 'p.line span.chord',

  /** A stated key, of which a chart may have none, one, or one per section. */
  key: 'p.key',

  /**
   * Both of the above at once, which is how they are read: in document order,
   * so that which chords fall under which key needs no reconstructing.
   */
  chartItems: 'p.key, p.line span.chord',

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
