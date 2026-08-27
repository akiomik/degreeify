import { type ApplyReport, apply } from '@/content/apply';
import type { Key } from '@/core/key';
import { formatNote } from '@/core/pitch';
import { overrideFor } from '@/settings/overrides';
import {
  DEFAULT_SETTINGS,
  type Detection,
  loadSettings,
  loadStamps,
  recordKey,
  SCHEMA_VERSION,
  type Settings,
  saveStamps,
  USED_AT_GRANULARITY,
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
      const current = await settings();
      const wanted = matters(current, pageId);
      if (wanted === showed) return;

      // Recorded once the page shows it, which is neither before the showing
      // nor after everything that follows it. Before, a run that threw while
      // painting would be remembered as the one on the page and a change back
      // to it skipped as a change to nothing; after, the same is true of a
      // run that painted and then failed to write down what it found.
      const painted = paint(doc, adapter, current, pageId);
      showed = wanted;

      await remember(current, pageId, stored, painted);
    };
    showing = showing.then(next, next);
    return showing;
  };

  // Listening before reading, so that a change made while the page is still
  // loading is not the one change nothing hears.
  const stop = watchSettings((settings) => {
    // Nothing is waiting on this one. A run that rejects with nobody attached
    // is an unhandled rejection, which in a content script is a line in a
    // console the reader will never open — the recovery is above, and this is
    // only about not shouting about it.
    void queue(() => settings).catch(() => {});
  });

  // The reading queued rather than awaited, so that a change arriving during
  // it is queued behind it and not in front of it. Awaited, the settings from
  // before the change would be the ones handed over last and would be the
  // ones that won — a reader who turned the names off inside that window
  // would watch them stay on until they reloaded the page.
  //
  // And a reading that fails falls back to the defaults rather than leaving
  // the page unnamed. Before there were settings this needed no storage at
  // all; a storage read that throws — an extension reloaded out from under an
  // open page is the ordinary way — must not be the difference between a
  // chart in degree names and a chart in none.
  await queue(() => loadSettings().catch(() => DEFAULT_SETTINGS));

  return stop;
}

/**
 * Everything about the settings that this page is shown from.
 *
 * The key kept for this chart without the stamp saying when it was last used:
 * the stamp is written by whichever page used it, is displayed nowhere, and
 * would otherwise be a change every open tab hears about.
 */
function matters(settings: Settings, pageId: string): string {
  const kept = settings.keyOverrides[pageId];

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
  settings: Settings,
  pageId: string,
  stored: string | null,
  { report, offset, key }: ReturnType<typeof paint>,
): Promise<void> {
  if (stored) await writeDetection(stored, record(pageId, report, offset));
  if (key && settings.enabled) await touchOverride(pageId);
}

/**
 * Marks a key as used today, and no more often than that.
 *
 * The stamp decides which keys are dropped when there are too many, so it has
 * to be written; it does not have to be written on every page a reader opens,
 * which would be a storage write for every chart they look at.
 */
async function touchOverride(pageId: string): Promise<void> {
  // Written to its own place in storage rather than back into the settings.
  // A page stamps a key while a reader is changing something in the popup,
  // and a whole-object write from either would undo the other's — reading
  // again first narrows that to one round trip and does not close it. Two
  // keys in storage cannot collide at all.
  const stamps = await loadStamps();
  const now = Date.now();

  if (now - (stamps[pageId] ?? 0) < USED_AT_GRANULARITY) return;

  await saveStamps({ ...stamps, [pageId]: now });
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
