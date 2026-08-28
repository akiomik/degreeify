import { type ApplyReport, apply } from '@/content/apply';
import type { Key } from '@/core/key';
import { formatNote } from '@/core/pitch';
import { overrideFor } from '@/settings/overrides';
import {
  asked,
  DEFAULT_SETTINGS,
  type Detection,
  isStored,
  loadStamp,
  MOST_DETECTIONS,
  pruneDetections,
  readSettings,
  recordKey,
  SCHEMA_VERSION,
  type Settings,
  saveStamp,
  USED_AT_GRANULARITY,
  watchForgetting,
  watchSettings,
  writeDetection,
} from '@/settings/storage';
import type { SiteAdapter } from '@/sites/types';

/**
 * Running the extension on a page, and following what a reader asks for
 * afterwards.
 *
 * The one place that knows about both a page and the settings kept for it.
 * `apply.ts` is handed everything it needs and reads nothing; this decides
 * what to hand it.
 */

/**
 * Reads the chart on a page and shows it, then keeps showing what is asked
 * for until the page goes away.
 *
 * Nothing happens on a page that holds no chart, which is most of a site.
 *
 * Hands back a way to stop listening. Nothing calls it in a content script,
 * where the page outliving the listener is the normal end of things, but a
 * test that leaves a listener behind is a test that hears about the next
 * one's writes.
 */
export async function run(doc: Document, adapter: SiteAdapter, url: URL): Promise<() => void> {
  if (!adapter.isChordPage(doc)) return () => {};

  // Before anything is measured. A width read while the page is still waiting
  // for its own font is a width nobody will see, and locking slots to it would
  // create the misalignment the lock exists to prevent.
  //
  // Asked for rather than reached through, for the reason `pageId` asks for
  // the head: `lib.dom` types this as always there and a document that is not
  // being rendered has no font set at all. There is nothing to wait for on
  // such a document, and a throw here would stop the script on that page.
  const fonts: FontFaceSet | undefined = doc.fonts;
  await fonts?.ready;

  const pageId = adapter.pageId(doc, url);
  const stored = recordKey(url.href);

  // What the page was last shown for. A settings change that does not change
  // any of it is a change about somewhere else — a key set for another chart
  // — and reading, restoring, measuring and rewriting this page over it would
  // be a flicker on every other tab open on the site, every time a reader set
  // a key on one.
  let showed: string | null = null;

  // What was painted, and whether it has been written down. The two are not
  // the same question: the page can be right while the record the popup reads
  // is stale, and only the second is worth trying again.
  let painted: ReturnType<typeof paint> | null = null;
  let recorded = false;

  /** Counts the writings, so that one can tell whether it is still the last. */
  let writing = 0;

  /** Whether the records have been tidied since this page was opened. */
  let tidied = false;

  /** The settings the page was last shown for, for a run that is not about them. */
  let current = DEFAULT_SETTINGS;

  let showing = Promise.resolve();
  const queue = (settings: () => Settings | Promise<Settings>) => {
    // Queued behind whatever is already running. Two runs at once would have
    // one restoring the page while the other is measuring it, and the widths
    // the second locked would be the widths the first had written.
    //
    // The same continuation on both sides, because a rejected promise passes
    // over every `then` after it: one failed write — a full quota, an
    // extension reloaded out from under the page — would leave the chain
    // rejected for good, and the page would stop following the settings
    // silently and for the rest of its life.
    const next = async () => {
      current = await settings();
      const wanted = matters(current, pageId);

      // Painted only where the page is not already showing this, and
      // recorded whether or not it was. `showed` is about the page: a run
      // that threw while painting must not be remembered as the one on the
      // page, and one that painted and then failed to write down what it
      // found has painted all the same.
      //
      // Which leaves the writing to be tried again on its own. Left to the
      // same guard, a record that failed to write would go on describing the
      // chart as it was before the reader's last change, and every settings
      // change that came back to this one would be skipped as a change to
      // nothing — with no way back short of a reload.
      if (wanted !== showed) {
        // Nothing, before anything is done to the page. `apply` restores
        // before it reads, so a reading that throws leaves the page in chord
        // names — and `showed` still naming the state it was in before would
        // have a change back to that state skipped as a change to nothing.
        // The page would stay in chord names for the rest of its life.
        showed = null;
        recorded = false;

        painted = paint(doc, adapter, current, pageId);
        showed = wanted;
      }

      if (!recorded && painted) {
        const first = !tidied;

        // Marked against this run rather than as a flag. The writing takes a
        // turn of the loop, and the record can be thrown away inside it — the
        // watcher below would set this back to false and queue a run, and a
        // plain `recorded = true` afterwards would overwrite what it had
        // asked for. The record would stay gone, which is the failure that
        // watcher exists to prevent.
        const mine = ++writing;
        await remember(pageId, stored, painted, first);

        // Both marked only once the whole of it has been done. Marked before,
        // a tidying that never finished would be spent all the same — and a
        // page whose store had no room would stop trying to make room, so the
        // popup would go on telling its reader to open a chord chart on the
        // chord chart in front of them for the rest of that page's life.
        if (writing === mine) recorded = true;
        tidied = true;
      }
    };
    showing = showing.then(next, next);
    return showing;
  };

  // And listening for the record being thrown away. Records are dropped by
  // count and nothing counting them knows which pages are open, so a chart
  // left open while the reader browses can have its own record dropped under
  // it — after which the popup tells them to open a chord chart on the chord
  // chart in front of them. This page is the one thing that can write it
  // again, and it still knows what it found.
  /** Writes down what the page is showing, where anyone could be looking. */
  const rewrite = () => {
    if (recorded || doc.hidden) return;
    void queue(() => current).catch(() => {});
  };

  const forgetting = stored
    ? watchForgetting(stored, () => {
        recorded = false;
        writing++;
        rewrite();
      })
    : () => {};

  // And when the page comes back into view. Writing it back only where the
  // page is being looked at is what keeps the tidying from being undone as it
  // happens: the popup drops the oldest records, and every open tab putting
  // its own straight back would make the tidying a burst of writes and
  // nothing else. A record is read by a popup, and a popup is opened over the
  // page in front of the reader.
  //
  // Which bounds this and does not cap it. A settings change is answered by
  // every open tab, hidden ones included — each is showing something new and
  // has to say so — so a reader with more chart tabs open than the store
  // holds will put it back above that number until they next open the popup.
  // What the number rules out is a store that grows with every chart anyone
  // has ever opened, and that it still does.
  doc.addEventListener('visibilitychange', rewrite);

  // Listening before reading, so that a change made while the page is still
  // loading is not the one change nothing hears.
  const stop = watchSettings((stored) => {
    // Nothing is waiting on this one. A run that rejects with nobody attached
    // is an unhandled rejection, which in a content script is a line in a
    // console the reader will never open — the recovery is above, and this is
    // only about not shouting about it.
    void queue(() => asked(stored)).catch(() => {});
  });

  // The reading queued rather than awaited, so that a change arriving during
  // it is queued behind it and not in front of it. Awaited, the settings from
  // before the change would be the ones handed over last and would be the
  // ones that won — a reader who turned the names off inside that window
  // would watch them stay on until they reloaded the page.
  //
  // A first showing that throws is caught here for the reason a later one is
  // caught in the watcher: nothing is listening but the content script's own
  // entry point, where an unhandled rejection is a line in a console the
  // reader will never open. The page is left in chord names, which is the
  // honest state for a page this could not read, and the next change is still
  // acted on.
  //
  // And a reading that fails leaves the page alone rather than writing on it
  // with the defaults. The chart is still read and still written down, so the
  // popup has something to say — but the defaults say to rewrite every chart,
  // and a reader who has turned that off has said the opposite. A setting
  // that cannot be read is not a setting that was never made.
  await queue(() =>
    readSettings()
      .then(asked)
      .catch(() => ({ ...DEFAULT_SETTINGS, enabled: false })),
  ).catch(() => {});

  return () => {
    stop();
    forgetting();
    doc.removeEventListener('visibilitychange', rewrite);
  };
}

/**
 * Everything about the settings that this page is shown from.
 *
 * The key kept for this chart without the stamp saying when it was last used:
 * the stamp is written by whichever page used it, is displayed nowhere, and
 * would otherwise be a change every open tab hears about.
 */
function matters(settings: Settings, pageId: string): string {
  const kept = Object.hasOwn(settings.keyOverrides, pageId)
    ? settings.keyOverrides[pageId]
    : undefined;

  return JSON.stringify({
    enabled: settings.enabled,
    notation: settings.notation,
    spelling: settings.spelling,
    key: kept ? { tonic: kept.tonic, mode: kept.mode } : null,
  });
}

/** Shows the chart as the settings ask for it, and says what it found. */
function paint(
  doc: Document,
  adapter: SiteAdapter,
  settings: Settings,
  pageId: string,
): { report: ApplyReport; offset: number | null; key: Key | null } {
  const offset = adapter.transposeOffset(doc);
  const key = overrideFor(settings, pageId, offset);

  // Read whether or not the names are being shown. Being switched off means
  // the page is left alone, not that nothing is known about it — a reader who
  // has the names off can still be told what key the chart is in, and would
  // find that display empty for no reason they could see if this branched any
  // earlier.
  const report = apply(doc, adapter, {
    notation: settings.notation,
    spelling: settings.spelling,
    key,
    write: settings.enabled,
  });

  return { report, offset, key };
}

/**
 * Writes down what the page turned out to be, for the popup to read.
 *
 * Kept apart from the showing because only one of the two is what a reader
 * sees. This can fail — a full quota, an extension reloaded out from under
 * the page — and the chart is named either way.
 */
async function remember(
  pageId: string,
  stored: string | null,
  { report, offset }: ReturnType<typeof paint>,
  tidy: boolean,
): Promise<void> {
  // Whether or not the names are being shown, and only where the key was the
  // one the chart was read in.
  //
  // Either way, because the chart is read either way and the stamp is the
  // only thing keeping a key from being the first dropped when there are too
  // many — a reader who browses with the names off, using the popup to see
  // what key a chart is in, would otherwise lose the keys they had set.
  //
  // Only where it was used, because a key set for a chart that has since been
  // edited to state a second one is not used at all: `apply` follows the
  // chart there. Stamping it anyway would keep an inert key fresh on every
  // visit, and it would outlive keys that are doing something.
  // Its failure is not allowed to carry off the record. A stamp that does not
  // land costs a key some of its standing among the ones kept; a record that
  // does not land is a popup telling a reader to open a chord chart on the
  // chord chart they are looking at.
  if (report.source === 'manual') await touchOverride(pageId).catch(() => {});

  if (!stored) return;

  // And what was found, last, because it is the one of the two that can fail
  // on a page that is otherwise fine — a full quota, an extension reloaded
  // out from under it. Written first, a failure would carry off the stamp
  // with it, and a key used every day on a page whose records will not write
  // would age towards being dropped while keys nobody touches do not.
  const found = record(pageId, report, offset);

  // Tidied here as well as in the popup, once for each page a reader opens.
  // Tidying only where somebody asked for something leaves a reader who never
  // opens the popup keeping a record of every chart they have ever read, and
  // a store that fills is one where the next record does not write — after
  // which the popup, on a chart, tells them to open a chord chart. Once per
  // page rather than per reading, so that changing a setting does not walk
  // the whole of storage on every open tab.
  //
  // After the writing, so that what was just written is counted and the store
  // settles at the number it is held to rather than one above it.
  const tidying = () => pruneDetections(MOST_DETECTIONS, stored).catch(() => {});

  try {
    await writeDetection(stored, found);
  } catch {
    // A store with no room left is the likeliest reason. Tidied and tried
    // once more rather than left to a later reading: the reader is sitting on
    // this page, so neither a settings change nor its coming back into view
    // is going to happen on its own.
    //
    // Whenever a write fails, and not only the first time this page writes.
    // A record dropped while its page was left open is written again, and if
    // that write fails for want of room too, a page that had spent its one
    // tidying would have no way left to make room — stuck without a record
    // for the rest of its life, which is what this exists to prevent.
    // One short of the number where what is about to be written is not among
    // what is being counted, and the whole number where it is. A record this
    // page wrote before and is writing again is already there and is already
    // the one being kept, so counting it out as well would drop a record that
    // did not need to go.
    const already = await isStored(stored).catch(() => false);
    await pruneDetections(already ? MOST_DETECTIONS : MOST_DETECTIONS - 1, stored).catch(() => {});
    await writeDetection(stored, found);
    return;
  }

  if (tidy) await tidying();
}

/**
 * Marks a key as used today, and no more often than that.
 *
 * The stamp decides which keys are dropped when there are too many, so it has
 * to be written; it does not have to be written on every page a reader opens,
 * which would be a storage write for every chart they look at.
 */
async function touchOverride(pageId: string): Promise<void> {
  // This chart's stamp and no other, in its own place in storage. A page
  // stamps a key while a reader is changing something in the popup, and a
  // write of everything from either would put back what the other had just
  // dropped — one key each is the only arrangement where that cannot happen.
  // How far apart they are, and not how much later now is. A stamp written
  // while the clock was ahead of itself is in the future once the clock is
  // put right, and a difference read as a small one would make that key fresh
  // for good — never re-stamped, never the oldest, and never dropped, while
  // keys the reader actually uses go around it.
  const now = Date.now();
  if (Math.abs(now - (await loadStamp(pageId))) < USED_AT_GRANULARITY) return;

  await saveStamp(pageId, now);
}

function record(pageId: string, report: ApplyReport, offset: number | null): Detection {
  return {
    version: SCHEMA_VERSION,
    pageId,
    key: report.key ? { tonic: formatNote(report.key.tonic), mode: report.key.mode } : null,
    source: report.source,
    statedKeys: report.statedKeys,
    unreadKeys: report.unreadKeys,
    transposeOffset: offset,
    named: report.named,
    updatedAt: Date.now(),
  };
}
