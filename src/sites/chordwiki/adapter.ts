import { type Key, parseKey } from '@/core/key';
import { ACCIDENTAL_CHARS } from '@/core/pitch';
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

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Whether a name was stopped in the middle of itself, asked of the one
 * character it was stopped at.
 *
 * Letters and digits, plainly. Accidentals too, and they are the reason this
 * is not simply punctuation: `C♭♭♭` is a note reader's refusal and not an
 * invitation to read `C♭♭` and leave the rest, which is reading something
 * other than what is written.
 *
 * The next character and not the rest of them, because the rest is not the
 * question. Asked of everything left over, `C, D` reads as C and `C,D` reads
 * as nothing, which makes whether a chart can be named turn on whether
 * somebody typed a space — and a key that cannot be read silences every
 * chord after it.
 *
 * The accidentals are asked of as a list rather than built into a pattern.
 * They are an open list, kept where notes are read and meant to grow, and a
 * `-` added to it would quietly turn into a range while a `]` would stop this
 * file loading at all — taking every chord on the page with it, for the sake
 * of one key line.
 */
function continuesAName(text: string): boolean {
  const [first] = text;
  if (!first) return false;

  return LETTER_OR_DIGIT.test(first) || ACCIDENTAL_CHARS.includes(first);
}

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
    if (key) return continuesAName(name.slice(end)) ? null : key;
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

/** The plus a form writes a space as. */
const PLUS = /\+/gu;

/** What a percent-escape that is not text decodes to, whatever it was. */
const REPLACEMENT_CHARACTER = '\uFFFD';

/** The title in a transposed chart's address, as written rather than as read. */
const WRITTEN_TITLE = new RegExp(`[?&]${TITLE_PARAM}=([^&]*)`, 'u');

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
 * A plus in a path is not obliged to mean a space, and in this one it does.
 * The site says so itself, in the address it gives for a chart whose title
 * has a space in it:
 *
 *     <input name="t" value="SWEET MEMORIES">
 *     <link rel="canonical" href="https://ja.chordwiki.org/wiki/SWEET+MEMORIES">
 *
 * and it writes its tags the same way, `/tag/WEST+GROUND` linking the words
 * `WEST GROUND`.
 */
function titleNamed(written: string): string | null {
  const query = written.replace(QUERY_SEPARATOR, '%26');
  const decoded = new URLSearchParams(`${TITLE_PARAM}=${query}`).get(TITLE_PARAM) ?? '';

  // Every escape that is not text decodes to the same character, so two
  // charts written in some encoding this is not would come back as one name
  // and share one chart's settings. Where that happens the title is kept
  // unread instead — spelled one way, since the two places it can sit do not
  // spell it the same, and kept apart from the titles that could be read,
  // since one of those can be spelled the same as an unread one.
  if (decoded.includes(REPLACEMENT_CHARACTER)) {
    return `${UNREAD_NAMESPACE}:${oneSpelling(written)}`;
  }

  return decoded ? `${CHART_NAMESPACE}:${decoded}` : null;
}

/** An escape, which is kept as it stands rather than read. */
const ESCAPE = /(%[0-9A-Fa-f]{2})/u;

/** What an address may spell a byte with, out of all the bytes there are. */
const SPELLED_PLAINLY = /[A-Za-z0-9]/u;

/**
 * Text with every byte spelled the one way an address can spell it.
 *
 * Byte by byte, and everything but a letter or a digit escaped, rather than
 * by whichever of the several escaping routines is to hand. They disagree —
 * a form escapes `(` and `~` where `encodeURIComponent` leaves them — and
 * disagreeing is the whole failure being avoided: a title spelled one way in
 * a path and another in a parameter is one chart under two names.
 */
function eachByteEscaped(text: string): string {
  return [...new TextEncoder().encode(text)]
    .map((byte) => {
      const spelled = String.fromCharCode(byte);
      return SPELLED_PLAINLY.test(spelled)
        ? spelled
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

/**
 * A title written the one way, for a title that could not be read.
 *
 * The same title is written differently in the two places it can sit — a
 * space is `%20` in a path and a plus in a parameter, an ampersand stands as
 * itself in one and is escaped in the other — and unread, those differences
 * are all that would be left to compare. What comes back here is every
 * escape as it stands, upper-cased, and everything else escaped: two
 * addresses for one chart arrive at one spelling, and two charts still do
 * not.
 */
function oneSpelling(text: string): string {
  return text
    .replace(PLUS, ' ')
    .split(ESCAPE)
    .map((part, index) => (index % 2 ? part.toUpperCase() : eachByteEscaped(part)))
    .join('');
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

  // Taken as written from either place and decoded once, so that what is done
  // about an escape that is not text is done about it wherever it was found.
  //
  // Trailing slashes come off the address rather than off the title: they are
  // the site's, not the chart's, and a chart reached with one and without it
  // is the same chart. Taken off afterwards they would take a real one with
  // them — `/wiki/Foo%2F` names a chart whose title ends in a slash, and the
  // other address for it would keep what this one had thrown away.
  const written =
    url.pathname === TRANSPOSED_CHART_PATH
      ? WRITTEN_TITLE.exec(url.search)?.[1]
      : url.pathname.slice(CHART_PATH.length).replace(TRAILING_SLASHES, '');

  return written ? titleNamed(written) : null;
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

/**
 * How far a transposition can go and still be one.
 *
 * An octave, inclusive: a chart transposed by twelve is the chart, which is a
 * transposition the control could offer and a thing the page would then be
 * saying. Beyond that it would be saying something shorter in a longer way,
 * which is not something this control does.
 */
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
  // Trimmed, because an option written without a value takes its text for
  // one and the site's markup puts that text on its own line. A browser
  // collapses the whitespace out of it and this DOM does not, which makes it
  // the tests that would find this — and only if one of them were written
  // with the markup laid out the way the site lays it out.
  const stated = value.trim();
  if (!WHOLE_NUMBER.test(stated)) return null;

  const offset = Number(stated);
  return Math.abs(offset) <= SEMITONES_IN_AN_OCTAVE ? offset : null;
}

/**
 * Which of the two things a name is: the chart of that title, or the page at
 * that address.
 *
 * Kept apart because a chart's title is whatever somebody typed. On a wiki
 * that is not a hypothetical — a page titled with the address of another page
 * is a page anybody can make, and without these the two would come back as
 * one name and share one set of settings.
 */
const CHART_NAMESPACE = 'chart';
const PAGE_NAMESPACE = 'page';

/**
 * A chart whose title could not be read, named by what its address spells
 * rather than by what that spells.
 *
 * Apart from the others for the same reason they are apart from each other: a
 * title that could not be read comes back as escapes, and a title that could
 * be read can contain those same characters. `%FC` is a title somebody can
 * type, and it is not the title an address spelling `%FC` is failing to say.
 */
const UNREAD_NAMESPACE = 'unread';

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
    // Asked here rather than assumed to have been asked already. The content
    // script reaches every page on the site, so a page that is not a chart
    // can be handed to this — and a page for editing one states that chart's
    // own address, which would let it claim the chart's settings by way of a
    // link rather than by being it.
    if (isChartAddress(url)) {
      // The site's own address for the chart first, since it is the site
      // saying which chart this is; then the one in the bar, which says that
      // too but with the view mixed in. All of them are read the same way,
      // and one that names no chart on this site — a link to somewhere else,
      // or an address that is not one — is passed over rather than believed.
      // Out of the head, and not out of the page. The chart body is written
      // by whoever wrote the chart, so a link in it is one reader's text and
      // not the site's word for where this chart lives — and taking it as the
      // site's would let one chart put its name on another's settings.
      //
      // The head is asked for rather than reached through. `lib.dom` types it
      // as always there, and on an HTML page it is; but the content script is
      // matched by address rather than by content type, and a document that
      // is not HTML — a feed, an XML resource — has none. Reaching through it
      // there throws, and a throw here is not one page misread but the script
      // stopping on that page. The type is why this needs saying: a reader
      // with the compiler's word for it would take the `?.` for clutter.
      const head: HTMLHeadElement | null = doc.head;
      const stated = [
        head?.querySelector(SELECTORS.canonical)?.getAttribute('href'),
        head?.querySelector(SELECTORS.openGraphUrl)?.getAttribute('content'),
        url.href,
      ];

      for (const href of stated) {
        const address = absolute(href, url);
        const title = address && chartNamed(address);
        if (title) return `${ID}:${title}`;
      }
    }

    // Not a chart. Whatever it is, it is at least itself, and it is itself
    // down to the query: two pages for editing two charts are one address and
    // two different pages. The fragment goes, being a place in a page.
    return `${ID}:${PAGE_NAMESPACE}:${url.origin}${url.pathname}${url.search}`;
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
    // The last of them and not the first. More than one marked option is not
    // valid, and where a page writes more than one a browser shows the last —
    // so reading the first would report a transposition nobody is looking at,
    // and a key would be shifted to somewhere the chart is not.
    const marked = [...doc.querySelectorAll<HTMLOptionElement>(SELECTORS.transposeSelected)].at(-1);
    const offset = marked && semitones(marked.value);

    // Nothing, rather than none: a page with no such control, or one whose
    // marked option says nothing, has not told us the chart is untransposed —
    // it has told us nothing, and a caller shifting a key by this had better
    // know which it is looking at.
    return offset ?? null;
  },
};
