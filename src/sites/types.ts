import type { Key } from '@/core/key';

/**
 * Reading a chord chart out of a page, and putting it back.
 *
 * One of these per site. What they have in common is what a chart is: chords
 * in document order, with the key changing as the chart says it does. How a
 * site writes that down is entirely its own business, and nothing outside an
 * adapter knows a selector.
 */
export interface ChordNode {
  /** The element holding the chord's text, which is the thing that gets rewritten. */
  readonly element: HTMLElement;
  /** What the chord says now, which on a transposed page is not what it said originally. */
  readonly text: string;
}

/**
 * A chart read in document order: the chords, and the keys they are read in.
 *
 * One sequence rather than a list of chords and a list of keys, because which
 * chords fall under which key is the whole of what the order is for, and
 * splitting them apart means putting that back together afterwards.
 *
 * A key whose declaration could not be read is a `key` item with none: a
 * chart that changes key part way through and says something unreadable at
 * one of those points has stopped saying what key it is in, and carrying on
 * with the previous one would name a whole section wrongly.
 */
export type ChartItem =
  | { readonly kind: 'key'; readonly key: Key | null; readonly raw: string }
  | { readonly kind: 'chord'; readonly node: ChordNode };

export interface SiteAdapter {
  /** Short name for the site, for settings and for saying which adapter ran. */
  readonly id: string;

  matches(url: URL): boolean;

  /**
   * Whether this page is a chord chart at all, as against a search result, an
   * index, or anything else the site serves from a matching address.
   */
  isChordPage(doc: Document): boolean;

  /**
   * The chart, or nothing where the page has none.
   *
   * A whole document, rather than the part of one the chart is in: where that
   * part is depends on the site, so finding it is the adapter's to do — and
   * an adapter that cannot find it must say so rather than read the page at
   * large, which is a chord chart's worth of damage to whatever else is on it.
   */
  readChart(doc: Document): ChartItem[];

  /**
   * A stable name for the chart, for settings to be saved against.
   *
   * The same chart transposed is the same chart, so this must not move when
   * the reader transposes it — otherwise a key they set by hand is lost the
   * moment they press a button, and from where they are sitting nothing about
   * the song changed.
   */
  pageId(doc: Document, url: URL): string;

  /**
   * How far the page has transposed the chart from what it was written in,
   * in semitones — zero when it has not, and nothing when the page does not
   * say.
   *
   * Those last two are not the same answer and must not be given as one. A
   * key a reader set by hand is kept against the chart untransposed and
   * shifted by this to be shown, and shifting by nothing because nothing was
   * known would show them a key the chart is not in.
   */
  transposeOffset(doc: Document): number | null;
}
