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
   * The control a reader transposes a chart with. The site's own is outside
   * the chart body — which is how it is told from one written into a chart,
   * a chart body being written by whoever wrote the chart.
   */
  transpose: TRANSPOSE,

  /**
   * The options that control arrived marked with, relative to the control and
   * never to the document. More than one is not valid, and where a page
   * writes more than one a browser takes the last, so the caller must too —
   * reading the first would report a transposition the reader is not looking
   * at.
   */
  transposeSelected: 'option[selected]',

  /**
   * The address the site considers this chart to live at, transposed or not.
   *
   * A `rel` is a list of words and the words are not case-sensitive, so
   * `Canonical` and `canonical alternate` are both this link. Asking for the
   * exact text misses them, and missing this link is not nothing: the name a
   * chart is given falls back to the address it was reached at, which moves
   * when the chart is transposed.
   */
  canonical: 'link[rel~="canonical" i]',
  /**
   * The same address said another way. Matched without regard to case for the
   * reason the link above is: missing it drops a chart's name back onto the
   * address it was reached at, which moves when the chart is transposed.
   *
   * Matched as a list of one word, though the attribute holds a single value.
   * That reads oddly and is exact — a value of one word is a list of one word
   * — and it is the only form the DOM the tests run in honours the flag with:
   * happy-dom takes `[a~="b" i]` and ignores the flag on `[a="b" i]`.
   */
  openGraphUrl: 'meta[property~="og:url" i]',
} as const;
