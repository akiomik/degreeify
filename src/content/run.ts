import { type ApplyReport, apply } from '@/content/apply';
import { formatNote } from '@/core/pitch';
import { overrideFor } from '@/settings/overrides';
import {
  type Detection,
  loadSettings,
  recordKey,
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

  let showing = show(doc, adapter, await loadSettings(), pageId, stored);
  await showing;

  return watchSettings((settings) => {
    // Queued behind whatever is already running. Two runs at once would have
    // one restoring the page while the other is measuring it, and the widths
    // the second locked would be the widths the first had written.
    showing = showing.then(() => show(doc, adapter, settings, pageId, stored));
  });
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
  if (key && settings.enabled) await touchOverride(settings, pageId);
}

/**
 * Marks a key as used today, and no more often than that.
 *
 * The stamp decides which keys are dropped when there are too many, so it has
 * to be written; it does not have to be written on every page a reader opens,
 * which would be a storage write for every chart they look at.
 */
async function touchOverride(settings: Settings, pageId: string): Promise<void> {
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
