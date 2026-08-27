import { type ApplyReport, apply } from '@/content/apply';
import { formatNote } from '@/core/pitch';
import { overrideFor } from '@/settings/overrides';
import {
  type Detection,
  loadSettings,
  recordKey,
  SCHEMA_VERSION,
  type Settings,
  saveSettings,
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

  // Listening before reading, so that a change made while the page is still
  // loading is not the one change nothing hears.
  //
  // And the reading queued rather than awaited, so that a change arriving
  // during it is queued behind it and not in front of it. Awaited, the
  // settings from before the change would be the ones handed over last and
  // would be the ones that won — a reader who turned the names off inside
  // that window would watch them stay on until they reloaded the page.
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
    const next = async () => show(doc, adapter, await settings(), pageId, stored);
    showing = showing.then(next, next);
    return showing;
  };

  const stop = watchSettings((settings) => {
    // Nothing is waiting on this one. A run that rejects with nobody attached
    // is an unhandled rejection, which in a content script is a line in a
    // console the reader will never open — the recovery is above, and this is
    // only about not shouting about it.
    void queue(() => settings).catch(() => {});
  });

  await queue(loadSettings);

  return stop;
}

async function show(
  doc: Document,
  adapter: SiteAdapter,
  settings: Settings,
  pageId: string,
  stored: string | null,
): Promise<void> {
  const offset = adapter.transposeOffset(doc);
  const key = overrideFor(settings, pageId, offset);

  // Read whether or not the names are being shown, and written down either
  // way. Being switched off means the page is left alone, not that nothing is
  // known about it — a reader who has the names off can still be told what
  // key the chart is in, and would find that display empty for no reason they
  // could see if this branched any earlier.
  const report = apply(doc, adapter, {
    notation: settings.notation,
    spelling: settings.spelling,
    key,
    write: settings.enabled,
  });

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
  // Read again rather than written from the settings this page was shown
  // with. Those were read before the page was measured and named, and a
  // reader can reach the popup in that time — writing the whole object back
  // from a copy that old would undo whatever they had just changed, and the
  // only sign of it would be a setting that went back on its own.
  const settings = await loadSettings();
  const stored = settings.keyOverrides[pageId];
  if (!stored) return;

  const now = Date.now();
  if (now - stored.usedAt < USED_AT_GRANULARITY) return;

  await saveSettings({
    ...settings,
    keyOverrides: { ...settings.keyOverrides, [pageId]: { ...stored, usedAt: now } },
  });
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
