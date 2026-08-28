import { type ChordSymbol, parseChord } from '@/core/chord';
import { type SpellingPolicy, toDegreeChord } from '@/core/degree';
import { inferKey, type Key, type KeySource } from '@/core/key';
import { formatDegreeChord, type Notation } from '@/core/notation';
import { MOST_STATED_KEYS_TO_OVERRIDE } from '@/settings/overrides';
import type { ChartItem, ChordNode, SiteAdapter } from '@/sites/types';

/**
 * Writing degree names onto a page, and taking them off again.
 *
 * Everything here is about the page rather than about music: which elements
 * are touched, what is kept so they can be put back, and what has to be
 * measured before they are changed. What a chord is called is `core`'s to
 * say and what is a chord at all is the site adapter's.
 */

/** Marks an element this has rewritten, and the hook the width lock hangs off. */
export const APPLIED_CLASS = 'degreeify-applied';

/** Where the chart's own text is kept while a degree name stands in for it. */
export const ORIGINAL_ATTRIBUTE = 'data-degreeify-original';

/** The locked width, read by the stylesheet as `var(--degreeify-w, auto)`. */
export const WIDTH_PROPERTY = '--degreeify-w';

/** Set on the root element so a stylesheet can tell the two states apart. */
export const STATE_ATTRIBUTE = 'data-degreeify';

export interface ApplyOptions {
  readonly notation?: Notation;
  readonly spelling?: SpellingPolicy;
  /**
   * A person's answer about what key this chart is in.
   *
   * Taken over the chart's own where the chart states at most one key, and
   * over the inference always. An override that cannot override is not one,
   * and one of the reasons to set a key is a chart whose stated key is read
   * correctly and is not the key its reader wants it in.
   *
   * Not taken where the chart states several. That is a chart that changes
   * key, and one answer for a whole page cannot be right for every section of
   * it.
   */
  readonly key?: Key | null;
  /**
   * Whether to write the names onto the page.
   *
   * False reads the chart and reports on it without touching it, which is
   * what the extension being switched off means: the page is left as the site
   * served it, and what was found on it is still found. A reader who has
   * turned the names off can still be shown what key the chart is in, and can
   * see it before turning them on.
   *
   * The same call either way, and not a second function that reads without
   * writing. Two paths to one report are two reports that can disagree, and
   * the one nobody is looking at is the one that would.
   */
  readonly write?: boolean;
}

/**
 * What was done to the page, for a caller with somewhere to say it.
 *
 * The counts are the part worth showing. A chart that comes back with every
 * name unwritten looks exactly like an extension that is switched off, and
 * the difference between "this chart states no key" and "two of its seven key
 * lines could not be read" is the difference between nothing being wrong and
 * something being wrong that a person could fix.
 */
export interface ApplyReport {
  /** Chord slots now showing a degree name. */
  readonly named: number;
  /** Slots left as the chart wrote them, whether or not they are chords. */
  readonly passed: number;
  /** Key lines the chart stated and this could not read. */
  readonly unreadKeys: number;
  /** Key lines the chart stated at all. */
  readonly statedKeys: number;
  /**
   * The key the chart was read in, and where that key came from.
   *
   * A key given from outside where one was taken — which is wherever the
   * chart states at most one, whether or not that one could be read.
   * Otherwise the first key the chart states that could be read, which is not
   * always the first it states: a chart whose opening declaration is
   * unreadable and whose second says `G` was read in G, and saying so is more
   * use than naming a line nothing could be done with. Failing both, the key
   * its chords point at.
   *
   * Null where the chart could not be read in any key, which is the answer a
   * caller has to be able to tell from "read in C" — a chart showing no
   * degree names and a chart showing them look different to a reader and
   * identical to an extension that is off.
   */
  readonly key: Key | null;
  readonly source: KeySource | null;
}

/**
 * Puts a page back the way the site served it.
 *
 * Asked of the page rather than of a chart, so that an element this rewrote
 * is found whether or not the adapter would offer it again — a site that
 * re-renders between the two would otherwise leave a degree name behind with
 * nothing left that knows it is one.
 */
export function restore(doc: Document): void {
  for (const element of doc.querySelectorAll<HTMLElement>(`.${APPLIED_CLASS}`)) {
    const original = element.getAttribute(ORIGINAL_ATTRIBUTE);
    if (original !== null) element.textContent = original;

    element.classList.remove(APPLIED_CLASS);
    element.removeAttribute(ORIGINAL_ATTRIBUTE);
    element.style.removeProperty(WIDTH_PROPERTY);
    // An element the site served without one should not keep an empty one.
    if (element.getAttribute('style') === '') element.removeAttribute('style');
  }

  doc.documentElement.setAttribute(STATE_ATTRIBUTE, 'off');
}

/**
 * Reads a chart, and writes degree names over its chord slots.
 *
 * Restores first and then applies, always, so that there is one path into the
 * page instead of one for a fresh page and another for a page already written
 * on. A caller changing a setting asks for this again and gets the same
 * answer it would get on a page it had never touched. Asked not to write, it
 * still restores: a page with the names turned off is a page as the site
 * served it.
 *
 * The adapter is taken rather than the chart it reads, because the chart has
 * to be read *after* the restoring and there is no way for a caller to be
 * told that which is as reliable as not having to be. A chart read off a page
 * this has already written on describes text that is no longer there once the
 * restoring is done: every slot would carry a degree name where a chord name
 * belongs, none of it would parse as a chord, and a second run would quietly
 * hand back a page with nothing named on it.
 *
 * The measuring has to have happened before any of the writing, which is why
 * the two passes below are separate: a page rewritten one element at a time
 * is measured against the widths its own earlier writes produced.
 *
 * Fonts are not waited for here. `document.fonts.ready` is the caller's to
 * await — measuring before the page's own font arrives locks widths to a font
 * nobody will see, which makes the misalignment this exists to prevent — and
 * a function that awaits nothing is one a test can call.
 */
export function apply(
  doc: Document,
  adapter: Pick<SiteAdapter, 'readChart'>,
  options: ApplyOptions = {},
): ApplyReport {
  restore(doc);

  const chart = adapter.readChart(doc);
  const { notation = 'roman-ascii', spelling = 'canonical', write: writing = true } = options;
  const opening = openingKey(chart, options.key);

  const named: { node: ChordNode; text: string }[] = [];
  let passed = 0;
  let unreadKeys = 0;
  let statedKeys = 0;

  let current = opening.follows ? null : opening.key;

  for (const item of chart) {
    if (item.kind === 'key') {
      // Whatever the line said, including that it could not be read. A chart
      // that states a new key part way through and says something unreadable
      // at one of those points has stopped saying what key it is in, and
      // carrying the previous one past that point names a whole section
      // against a tonic that is not there. Left with no key, the section is
      // passed through instead, which is the failure worth having.
      statedKeys++;
      if (!item.key) unreadKeys++;
      if (opening.follows) current = item.key;
      continue;
    }

    // A slot the chart has no key for, and a slot holding something that is
    // not a chord, come to the same thing here: left as the chart wrote it,
    // unmarked and unmeasured, so that nothing about it changes and there is
    // nothing about it to put back.
    const text = current ? nameOf(item.node.text, current, spelling, notation) : null;
    if (text === null) {
      passed++;
      continue;
    }

    named.push({ node: item.node, text });
  }

  if (writing) write(named);

  // Said here rather than left to the restoring above, which sets it to `off`
  // on the way in. Both orders leave the same attribute on the page; this one
  // does not need a reader to have followed the restore to know why.
  doc.documentElement.setAttribute(STATE_ATTRIBUTE, writing ? 'on' : 'off');

  return {
    named: named.length,
    passed,
    unreadKeys,
    statedKeys,
    key: opening.key,
    source: opening.source,
  };
}

/** The degree name for a chord slot, or nothing where it holds no chord. */
function nameOf(
  text: string,
  key: Key,
  spelling: SpellingPolicy,
  notation: Notation,
): string | null {
  const chord = parseChord(text);
  return chord ? formatDegreeChord(toDegreeChord(chord, key, spelling), notation) : null;
}

/**
 * The key a chart is read in, before it states one of its own.
 *
 * `key` is what the chart is in and `opening` is what the fold starts on, and
 * they are not the same where a chart states its key. A chart that states one
 * states it above its chords — on every real page checked, the key line is
 * the first thing the adapter reads and no chord comes before it — so a chord
 * ahead of the first statement is one the chart has said nothing about, and
 * it is left alone rather than named in a key stated afterwards.
 *
 * A key given from outside answers for a chart that one key can answer for,
 * and for no other:
 *
 * - a chart with no key line, which is what the popup exists for;
 * - a chart with one key line, whether or not it could be read. Read, the
 *   reader is disagreeing with the page, which is a thing to be allowed to do
 *   — an override that cannot override is not one. Unread, they can see a key
 *   on the page and would have no idea why setting one did nothing;
 * - but not a chart with more than one key line. More than one statement is a
 *   chart that changes key, and one key given for the whole page cannot be
 *   right for every section of it. There the chart is followed, and a section
 *   whose statement could not be read stops rather than borrowing the key
 *   given for the page — which is what the report's count is for.
 */
function openingKey(chart: readonly ChartItem[], given: Key | null | undefined): Reading {
  const stated = chart.filter((item) => item.kind === 'key');

  // A person's answer first, where the chart is one a single answer can cover.
  // A key set by hand is set by somebody looking at the page, and an override
  // that cannot override is not one: the reasons for setting one include a
  // chart whose stated key this reads correctly and whose reader disagrees
  // with it.
  if (given && stated.length <= MOST_STATED_KEYS_TO_OVERRIDE) {
    return { key: given, source: 'manual', follows: false };
  }

  const read = stated.find((item) => item.key)?.key;
  if (read) return { key: read, source: 'page', follows: true };

  if (stated.length > MOST_STATED_KEYS_TO_OVERRIDE) {
    return { key: null, source: null, follows: true };
  }

  const guess = inferKey(chordsIn(chart));
  const inferred = guess ? guess.key : null;
  return { key: inferred, source: inferred ? 'inferred' : null, follows: inferred === null };
}

interface Reading {
  /** What the chart is in, for a caller with somewhere to show it. */
  readonly key: Key | null;
  readonly source: KeySource | null;
  /**
   * Whether the chart's own key lines are what the reading follows.
   *
   * True is the ordinary case and says two things at once: the chart's
   * statements move the reading, and nothing is being read until the first of
   * them — a chord above the chart's first key line is one the chart has said
   * nothing about yet.
   *
   * False wherever a key from outside was taken, which is wherever the chart
   * states at most one of its own. Then there is nothing to wait for and
   * nothing to follow: the key covers the chart from its first slot, and the
   * one line the chart does state is the line it was taken over, so letting
   * that line move the reading would take the key away at the first thing it
   * was given for.
   *
   * What the fold starts on follows from this rather than being carried
   * alongside it. Two fields that have to agree are two fields that can stop
   * agreeing, and the day this grows a fifth case is the day they would.
   */
  readonly follows: boolean;
}

function chordsIn(chart: readonly ChartItem[]): ChordSymbol[] {
  return chart.flatMap((item) => {
    if (item.kind !== 'chord') return [];
    const chord = parseChord(item.node.text);
    return chord ? [chord] : [];
  });
}

/**
 * Locks each slot's width and then writes its name.
 *
 * Every measurement is taken before any of them is written, because reading a
 * width after a write forces the browser to lay the page out again — once per
 * element, on a chart of four hundred of them.
 *
 * A width of nothing is not locked. An element that is not being rendered
 * measures zero, and a zero written into the property would fix it at nothing
 * and take the chord off the page. The stylesheet falls back to `auto` for
 * the same reason, so a slot with no lock is a slot that lays itself out.
 */
function write(targets: readonly { node: ChordNode; text: string }[]): void {
  const widths = targets.map(({ node }) => node.element.getBoundingClientRect().width);

  targets.forEach(({ node, text }, index) => {
    const { element } = node;
    const width = widths[index] ?? 0;

    if (width > 0) element.style.setProperty(WIDTH_PROPERTY, `${width}px`);
    element.setAttribute(ORIGINAL_ATTRIBUTE, element.textContent ?? '');
    element.classList.add(APPLIED_CLASS);
    element.textContent = text;
  });
}
