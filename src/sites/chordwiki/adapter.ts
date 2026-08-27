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

/** What that address says is being done with the chart, of which only one is reading it. */
const ACTION_PARAM = 'c';
const VIEWING_ACTION = 'view';

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

/**
 * Anything in front of the key name that cannot be part of one.
 *
 * A line writes a key with something around it more often than it looks:
 * `Key: (C)`, `Key: C, D`. What is captured runs to the next space or slash,
 * so the punctuation comes with it and the name is then no name — and a key
 * that cannot be read stops the naming for the rest of the section, so a
 * single stray bracket costs a chart from there on.
 */
const NOT_PART_OF_A_NAME = /^[^\p{L}\p{N}]+/u;

/** Nothing but punctuation, which is all a name is allowed to be read past. */
const ONLY_PUNCTUATION = /^[^\p{L}\p{N}]*$/u;

/**
 * The key a captured name states, reading as much of it as is one.
 *
 * From the front and outwards, longest first, so that `C,` is read as C
 * rather than as nothing. What a key may be called is still `parseKey`'s to
 * say; this only decides how much to hand it.
 *
 * What gets left off has to be punctuation and nothing else. Reading up to
 * whatever happens to parse would take `EM` — which is `Em` shouted, and
 * which no reader here can make a minor key of — and quietly call it E major
 * by dropping a letter. A key that cannot be read is the honest answer there,
 * and stopping is what the section deserves.
 */
function keyNamed(captured: string): Key | null {
  const name = captured.replace(NOT_PART_OF_A_NAME, '');

  for (let end = name.length; end > 0; end--) {
    const key = parseKey(name.slice(0, end));
    if (key) return ONLY_PUNCTUATION.test(name.slice(end)) ? key : null;
  }

  return null;
}

function readKeyLine(text: string): Key | null {
  const played = PLAYED.exec(text)?.[1];
  if (played) return keyNamed(played);

  // A line that names what the chart was written in without naming what is
  // being played is a shape nothing here has seen. The key it does name is
  // not the one the chords are in, so the honest answer is that this section
  // no longer says.
  if (TRANSPOSED.test(text)) return null;

  const written = WRITTEN.exec(text)?.[1];
  return written ? keyNamed(written) : null;
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

function isChartAddress(url: URL): boolean {
  const host = url.hostname;
  if (host !== HOST && !host.endsWith(`.${HOST}`)) return false;

  if (url.pathname.startsWith(CHART_PATH)) return true;
  if (url.pathname !== TRANSPOSED_CHART_PATH) return false;

  // That address serves more than charts — editing one, its history, a diff
  // — and all of them name the chart they are about. A page that is not the
  // chart must not claim the chart's settings.
  const action = url.searchParams.get(ACTION_PARAM);
  return action === null || action === VIEWING_ACTION;
}

/**
 * The separator a synthesised query would otherwise be cut at.
 *
 * A `#` cannot reach this — a URL keeps it out of the path — and a second `=`
 * is part of a value rather than the end of one, so an `&` is the whole of
 * what has to be got out of the way.
 */
const QUERY_SEPARATOR = /&/g;

/** Slashes the address ends with, which belong to the address. */
const TRAILING_SLASHES = /\/+$/u;

/**
 * Text decoded as a form encodes it: a plus is a space, and a broken escape
 * is a replacement character rather than a thrown error.
 *
 * One decoder, applied to both places a title can sit in an address, because
 * two decoders is what the round before last was. `decodeURIComponent` reads
 * a plus as a plus and throws on a broken escape, and a query read that way
 * would call `Rock+Roll` two different charts depending on which address a
 * reader arrived at — and lose the chart's name altogether the first time a
 * title carried a stray percent sign.
 *
 * That a path is read the same way is the site's doing and not an assumption.
 * It writes a space into a path segment as a plus, which is a thing a path is
 * not obliged to mean and this one does:
 *
 *     <a href="/tag/WEST+GROUND">WEST GROUND</a>
 */
function formDecoded(text: string): string {
  const escaped = text.replace(QUERY_SEPARATOR, '%26');
  return new URLSearchParams(`${TITLE_PARAM}=${escaped}`).get(TITLE_PARAM) ?? '';
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

  if (url.pathname === TRANSPOSED_CHART_PATH) return url.searchParams.get(TITLE_PARAM) || null;

  // Trailing slashes come off the address rather than off the title: they are
  // the site's, not the chart's, and a chart reached with one and without it
  // is the same chart. Taken off afterwards they would take a real one with
  // them — `/wiki/Foo%2F` names a chart whose title ends in a slash, and the
  // other address for it would keep what this one had thrown away.
  const segment = url.pathname.slice(CHART_PATH.length).replace(TRAILING_SLASHES, '');
  return formDecoded(segment) || null;
}

/**
 * The chart on the page, or nothing where there is none.
 *
 * The wrapper holding chords, rather than the first wrapper. The site could
 * put page furniture in another of these tomorrow, and taking the first would
 * then answer that the page is not a chart and read nothing from it — a
 * failure that looks exactly like the extension being switched off, which is
 * the kind that goes unnoticed longest.
 *
 * Everything read out of a chart comes off this one element, so that whether
 * a page is a chart and which chart it is cannot be answers about different
 * parts of it.
 */
function chartIn(doc: Document): Element | null {
  for (const candidate of doc.querySelectorAll(SELECTORS.chart)) {
    if (candidate.querySelector(SELECTORS.chord)) return candidate;
  }
  return null;
}

/** How far a transposition can go before it is the same as a shorter one. */
const SEMITONES_IN_AN_OCTAVE = 12;

/** A whole number of semitones and nothing else. */
const WHOLE_NUMBER = /^[+-]?\d+$/u;

/**
 * A transposition read off a control, or nothing where what it says is not
 * one.
 *
 * Strictly, because `Number.parseInt` reads as far as it understands and
 * stops: `1e3` is one to it, `6x` is six, and a number of any size at all
 * passes for a count of semitones. What is not a plain whole number within an
 * octave is not something this control said.
 */
function semitones(value: string): number | null {
  if (!WHOLE_NUMBER.test(value)) return null;

  const offset = Number(value);
  return Math.abs(offset) < SEMITONES_IN_AN_OCTAVE ? offset : null;
}

export const chordwiki: SiteAdapter = {
  id: ID,

  matches: isChartAddress,

  isChordPage(doc) {
    return chartIn(doc) !== null;
  },

  readChart(doc) {
    // No chart, nothing to read. Reading the page at large instead would be a
    // chord chart's worth of rewriting let loose on whatever else is on it,
    // the first time the site renames the wrapper.
    const chart = chartIn(doc);
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
    // The option's value and not its `value` attribute: an option written
    // without one takes its text for its value, so `<option selected>+6` is a
    // transposition of six and reading the attribute would call it nothing at
    // all — a key shifted by nothing, silently, which is the failure this
    // file keeps warning about.
    const marked = doc.querySelector<HTMLOptionElement>(SELECTORS.transposeSelected);
    const offset = marked && semitones(marked.value);

    // Nothing, rather than none: a page with no such control, or one whose
    // marked option says nothing, has not told us the chart is untransposed —
    // it has told us nothing, and a caller shifting a key by this had better
    // know which it is looking at.
    return offset ?? null;
  },
};
