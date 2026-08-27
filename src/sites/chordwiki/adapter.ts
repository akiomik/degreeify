import { DASH_LOOKALIKES, DASH_MARKS, PLUS_MARKS } from '@/core/chord';
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
 *
 * `Key:` is read only where the line opens with it, and that is the whole of
 * what keeps a written key from being taken for a played one. Anchored, the
 * line has to be the shape the site writes; unanchored, every spelling of
 * "the key it was written in" that the guard below does not know becomes a
 * played key — `原曲Key: C` on a Japanese site, `Orig. Key: C`,
 * `Original-Key: C`. A guard that has to enumerate those is a guard that
 * will be missing one, and what it misses is not a key gone unread but a
 * section named against a tonic the page is not in. Missing a `Play:` costs
 * a name; taking a `Key:` that was not one costs a wrong name, which this
 * file spends itself avoiding.
 */
const PLAYED = /\bPlay\s*[:：]\s*([^\s/／]+)/iu;
const WRITTEN = /^Key\s*[:：]\s*([^\s/／]+)/iu;
const TRANSPOSED = /\bOriginal\s+Key\s*[:：]/iu;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * The characters that are part of a key's name rather than punctuation after
 * it, besides the letters and the digits.
 *
 * Taken from where notes and chords are read rather than written out again,
 * so that a spelling added there cannot go missing here.
 */
const NAMES_CARRY = ACCIDENTAL_CHARS + DASH_MARKS + DASH_LOOKALIKES + PLUS_MARKS;

/** Whether a character is part of a key's name rather than something around it. */
function partOfAName(char: string): boolean {
  return LETTER_OR_DIGIT.test(char) || NAMES_CARRY.includes(char);
}

/**
 * A captured name with what is in front of it taken off.
 *
 * A line writes a key with something around it more often than it looks:
 * `Key: (C)`, `Key: C, D`. What is captured runs to the next space or slash,
 * so the punctuation comes with it and the name is then no name — and a key
 * that cannot be read stops the naming for the rest of the section, so a
 * single stray bracket costs a chart from there on.
 *
 * What comes off is asked with the same question the far end is asked with,
 * and that matters more than it reads. Taking off everything that is not a
 * letter or a digit takes an accidental with it: `♭B` would be read as B,
 * a whole section named a semitone from where the page is, with nothing
 * anywhere to say so — while `C♭♭♭` at the other end is correctly no key at
 * all. A name that begins with something a name is made of has not been
 * found yet, and stopping is the answer at both ends.
 */
function nameIn(captured: string): string {
  // Character by character and not unit by unit. A character outside the
  // basic plane is written in two units, and asking about half of one asks
  // about a piece of nothing: `\p{L}` does not match a lone surrogate, so
  // both halves would come off as punctuation and `𠮟C` would read as C —
  // the very reading the far end was taught to refuse. `continuesAName`
  // takes its character off the front of a string and so has always counted
  // this way; the two ends have to count the same way as well as ask the
  // same question.
  let at = 0;
  for (const char of captured) {
    if (partOfAName(char)) break;
    at += char.length;
  }

  return captured.slice(at);
}

/**
 * Whether a name was stopped in the middle of itself, asked of the one
 * character it was stopped at.
 *
 * Letters and digits, plainly. Accidentals too, and they are the reason this
 * is not simply punctuation: `C♭♭♭` is a note reader's refusal and not an
 * invitation to read `C♭♭` and leave the rest, which is reading something
 * other than what is written.
 *
 * A dash as well, because a dash after a key name means something and this
 * cannot tell which: `C-` is C minor to a lead sheet and `C-Dur` is C major
 * to a German one, and answering C major confidently would label a whole
 * section a minor third out wherever the first reading was meant. Neither is
 * a form seen on this site, which is the argument for stopping rather than
 * for picking one.
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

  return first !== undefined && partOfAName(first);
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
  const name = nameIn(captured);

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
  //
  // Kept although the anchor on `WRITTEN` already declines a line opening
  // this way, because the two say different things: the anchor says a key
  // has to be the first thing on the line, and this says a line naming an
  // original key is not naming a played one wherever it names it. What they
  // cover between them is a line that opens `Key:` and goes on to name an
  // original — where reading the opening would be reading half a line.
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

/** Slashes the address ends with, which belong to the address. */
const TRAILING_SLASHES = /\/+$/u;

/**
 * Whether an address asks for the chart rather than something about it.
 *
 * The site serves more than charts — editing one, its history, a diff — and
 * all of them name the chart they are about. A page that is not the chart
 * must not claim the chart's settings.
 *
 * Asked of every address and not only of the one the parameter is usually
 * written on. Which path serves what is the site's to change, and a `/wiki/`
 * path that rewrites to the same program would carry the parameter just as
 * well: `/wiki/Test?c=edit` was a chart while `wiki.cgi?c=edit&t=Test` was
 * not, which is one page under two names and one of them wrong.
 *
 * Every value of it and not the first. A query may name a parameter twice,
 * the reader before this one is free to resolve that either way, and `?c=view&c=edit`
 * taken as viewing is a link somebody sends that puts an editing page on a
 * chart's settings. What the title is asked in the same situation took three
 * rounds to get right; there is no reason to learn it twice.
 */
function isViewing(url: URL): boolean {
  return url.searchParams.getAll(ACTION_PARAM).every((action) => action === VIEWING_ACTION);
}

function isChartAddress(url: URL): boolean {
  const host = url.hostname;
  if (host !== HOST && !host.endsWith(`.${HOST}`)) return false;
  if (!isViewing(url)) return false;

  // One segment, and the whole of one. A path is read as a title written
  // into it, and a title written into a path has its slashes escaped — so
  // `/wiki/a%2Fb` is a chart called `a/b` and `/wiki/a/b` is somewhere else
  // on the site. Taking everything after `/wiki/` would read them as one
  // chart, which is two charts sharing one chart's settings. Trailing slashes
  // are the address's rather than the title's and are not counted.
  if (url.pathname.startsWith(CHART_PATH)) {
    return !url.pathname.slice(CHART_PATH.length).replace(TRAILING_SLASHES, '').includes('/');
  }

  return url.pathname === TRANSPOSED_CHART_PATH;
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

/**
 * The replacement character as an address may write it, being a character a
 * title is allowed to contain like any other. Properly escaped, or standing
 * in the address as itself — a path may hold it either way.
 */
const WRITTEN_REPLACEMENT = /%EF%BF%BD|\uFFFD/giu;

/** How many times `character` occurs in `text`. */
const timesIn = (text: string, character: string): number => text.split(character).length - 1;

/** What a query is cut into fields on, and what ends a field's name. */
const QUERY_FIELDS = /&/u;
const NAME_ENDS = '=';

/**
 * The title in a transposed chart's address, as written rather than as read.
 *
 * Which field is the title is asked of the parser, and only where it is
 * answered here. A query is cut on `&` and its fields are named in escapes,
 * and both of those have already been got wrong once each: a `?` is legal
 * inside a value, and `%74=` is a field called `t`. Reading a field name here
 * would be a second parser, and the two coming apart is a reader following a
 * link to one chart and reading another chart's settings.
 *
 * So the names come from the parser and the text comes from the address, and
 * they are matched by position. Empty fields are dropped first because the
 * parser drops them: `a=1&&t=x` is two fields to it and three to a split, and
 * a position out of step is the same disagreement in a new place.
 *
 * The value alone is taken as written, because a title that cannot be read
 * has to keep the spelling it was written in and the parser would give it
 * back read.
 */
function writtenTitleIn(url: URL): string | undefined {
  const at = [...url.searchParams.keys()].indexOf(TITLE_PARAM);
  if (at < 0) return undefined;

  const field = url.search.slice(1).split(QUERY_FIELDS).filter(Boolean)[at];
  if (field === undefined) return undefined;

  const ends = field.indexOf(NAME_ENDS);
  return ends < 0 ? '' : field.slice(ends + 1);
}

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
  //
  // Counted rather than looked for, because the character the decoder puts
  // there is one a title may contain: an address that spells it properly is
  // saying it, not failing to. Only where more come back than were written is
  // something being stood in for.
  if (timesIn(decoded, REPLACEMENT_CHARACTER) > (written.match(WRITTEN_REPLACEMENT)?.length ?? 0)) {
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
 * One escape, spelled the way this spells the character it stands for.
 *
 * An address may escape a character that needs no escaping, and then the two
 * addresses for one chart hold the same title in two spellings: `A%FC` and
 * `%41%FC` are the same title, and were two names for it. Where an escape
 * stands for a character this would write plainly, it is written plainly.
 */
function escapeSpelled(written: string): string {
  const spelled = String.fromCharCode(Number.parseInt(written.slice(1), 16));

  return SPELLED_PLAINLY.test(spelled) ? spelled : written.toUpperCase();
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
    .map((part, index) => (index % 2 ? escapeSpelled(part) : eachByteEscaped(part)))
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
  const written =
    url.pathname === TRANSPOSED_CHART_PATH
      ? writtenTitleIn(url)
      : url.pathname.slice(CHART_PATH.length);

  // Trailing slashes come off the address rather than off the title: they are
  // the site's, not the chart's, and a chart reached with one and without it
  // is the same chart.
  //
  // Off both spellings and not just the path. The form the site submits
  // writes a slash as `%2F`, so a bare one at the end of a parameter is the
  // address's in the way it is in a path — and stripping it in one place only
  // is how a chart comes to have two names, which is the whole of what this
  // function is for. It has to happen before the escapes are read, too: taken
  // off afterwards it would take a real slash with it, and `/wiki/Foo%2F`
  // names a chart whose title ends in one.
  const title = written?.replace(TRAILING_SLASHES, '');

  return title ? titleNamed(title) : null;
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
    // A chord slot `readChart` can do something with, and not merely one that
    // matches. A selector matches on names and attributes, which a document
    // that is not HTML carries as readily as one that is, and `readChart`
    // keeps only the slots that are `HTMLElement`s — so accepting a wrapper
    // on a match alone is how a page comes back as a chart with no chords in
    // it, which is the extension having nothing to say and saying nothing
    // about why.
    for (const chord of candidate.querySelectorAll(SELECTORS.chord)) {
      if (chord instanceof HTMLElement) return candidate;
    }
  }
  return null;
}

/**
 * The controls on a page that could be the site's, in the order to try them.
 *
 * Outside every wrapper a chart can be written into, where there is such a
 * control — which on this site there is, the form sitting above the chart.
 * Nothing a chart's author writes can reach outside one, so this is the
 * reading a chart cannot touch, and it is the one to prefer.
 *
 * Failing that, outside the chart. A wrapper is not a chart because it could
 * hold one: which wrapper does is {@link chartIn}'s to say, and a page
 * wrapping its own control the way it wraps its chart — one control laid out
 * beside a chart in a second wrapper is not a strange thing to do — would
 * otherwise put the site's own control out of reach and lose every
 * transposition on the site.
 *
 * And nothing at all where there is no chart. That is what keeps the second
 * reading from being a way around the first: an author's markup sits inside
 * the wrapper the site put their chart in, so a wrapper they write is one
 * nested in it and the chart still contains everything they wrote. A page
 * with no chart in it has nothing this answer could be about anyway.
 */
function controlsWorthReading(doc: Document): Element[] {
  const controls = [...doc.querySelectorAll(SELECTORS.transpose)];

  const beyondReach = controls.filter((control) => !control.closest(SELECTORS.chart));
  if (beyondReach.length > 0) return beyondReach;

  const chart = chartIn(doc);
  return chart ? controls.filter((control) => !chart.contains(control)) : [];
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
        // Asked rather than asserted. A selector matches on names and
        // attributes, which a document that is not HTML can carry as readily
        // as one that is — and its elements are not `HTMLElement`s. The
        // content script is matched by address rather than by content type,
        // which is why `pageId` guards the head, and the same document
        // reaches this. Asserted here instead, nothing would go wrong until a
        // caller reached for `style` to hold a column still, a long way from
        // the line that was wrong.
        if (element instanceof HTMLElement) {
          items.push({ kind: 'chord', node: { element, text } });
        }
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
    // Which controls could be the site's, and in what order to try them, is
    // `controlsWorthReading`'s to say and is argued there.
    for (const control of controlsWorthReading(doc)) {
      // Which option the page arrived with marked, rather than which one the
      // DOM says is selected. The page arrives marked and changing the
      // control submits the form, so what the page states is what is being
      // shown and there is no moment at which a reader has moved it and the
      // page has not caught up.
      //
      // That the DOM the tests run in disagrees is a second reason and not
      // the first, but it is not a small one: on the pages saved to check
      // this, happy-dom's `select.value` answers `5` where the page marks
      // `0`, and `-1` for `selectedIndex` on the transposed one. Six of the
      // seven disagree with what the page states. A reading built on the
      // DOM's idea of selectedness would have been wrong about nearly every
      // real page and green in every test.
      //
      // Where the site stops marking an option — were it to set the control
      // from a script instead — this answers nothing, on every page at once.
      // That is the chosen failure rather than an overlooked one: the
      // alternative readings are the first option, which is `+6` here and
      // was measured wrong in an earlier round, and the DOM's, which is the
      // one just measured wrong. Answering nothing leaves a caller able to
      // tell that it does not know.
      //
      // The last of them where a page marks more than one, which is not valid
      // and is what a browser shows — reading the first would report a
      // transposition nobody is looking at.
      //
      // Nothing where none is marked, and deliberately not the first option.
      // The first option is what the control would send, not what the page is
      // showing, and those come apart here: the site lists its options from
      // `+6` down to `-5`, so falling back to the first would answer six for
      // every untransposed chart on the site and shift a reader's key by a
      // tritone.
      // Asked what they are rather than told, for the reason `readChart` asks
      // its chord slots: a selector matches on names and attributes, which a
      // document that is not HTML carries as readily as one that is, and its
      // options have no value to read. Asserted, this would throw — and a
      // throw here is not one page misread but the script stopping on that
      // page, which is the whole of why the head is guarded.
      const marked = [...control.querySelectorAll(SELECTORS.transposeSelected)]
        .filter((option) => option instanceof HTMLOptionElement)
        .at(-1);

      // The option's value, and not the `value` attribute it may not have: an
      // option written without one takes its text for its value, so
      // `<option selected>+6` is a transposition of six and reading the
      // attribute would call it nothing at all — a key shifted by nothing,
      // silently, which is the failure this file keeps warning about.
      const offset = marked && semitones(marked.value);
      if (offset !== null && offset !== undefined) return offset;

      // On to the next rather than done. A page may carry the form more than
      // once — one control laid out for a narrow window and one for a wide
      // one is ordinary — and only the copy being shown need be marked. Both
      // are the site's, so the one that says something is the one to take;
      // stopping at the first would report nothing about a chart that has
      // plainly been transposed.
    }

    // Nothing, rather than none: a page with no such control, or one whose
    // marked option says nothing, has not told us the chart is untransposed —
    // it has told us nothing, and a caller shifting a key by this had better
    // know which it is looking at.
    return null;
  },
};
