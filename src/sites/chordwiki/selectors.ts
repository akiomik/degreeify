/**
 * Every selector ChordWiki is read through, in one place.
 *
 * A site can change its markup at any time, and when it does this is the file
 * that is wrong. Keeping them together is also what makes it possible to say
 * what the adapter depends on without reading it.
 */
export const SELECTORS = {
  /** The wrapper the chart itself sits in. Its parent has neither id nor class. */
  chart: 'div.main',

  /** Chord slots. Not every one holds a chord — see the chord parser. */
  chord: 'p.line span.chord',

  /** A stated key, of which a chart may have none, one, or one per section. */
  key: 'p.key',

  /**
   * Both of the above at once, which is how they are read: in document order,
   * so that which chords fall under which key needs no reconstructing.
   */
  chartItems: 'p.key, p.line span.chord',

  /** How far the page has transposed the chart, as a select the reader drives. */
  transpose: '#key select[name="key"]',

  /** The option that select arrived with, which is how far it has been transposed. */
  transposeSelected: '#key select[name="key"] option[selected]',

  /** The address the site considers this chart to live at, transposed or not. */
  canonical: 'link[rel="canonical"]',
  openGraphUrl: 'meta[property="og:url"]',
} as const;
