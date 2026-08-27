import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { browser } from 'wxt/browser';
import type { SpellingPolicy } from '@/core/degree';
import { CANONICAL_TONIC, formatKey, type Key, type Mode } from '@/core/key';
import type { Notation } from '@/core/notation';
import { parseNote } from '@/core/pitch';
import { overrideFor, withOverride, withoutOverride } from '@/settings/overrides';
import {
  type Detection,
  loadSettings,
  pruneDetections,
  readDetection,
  recordKey,
  type Settings,
  saveSettings,
  watchDetection,
} from '@/settings/storage';
import styles from './App.module.css';

/**
 * How many keys a chart may state and still be one a single key can answer
 * for. Past that it changes key, and one key set for the page cannot be right
 * for every section of it.
 */
const MOST_STATED_KEYS_TO_OVERRIDE = 1;

function App() {
  const [settings, setSettings] = createSignal<Settings | null>(null);
  const [detection, setDetection] = createSignal<Detection | null>(null);

  onMount(async () => {
    // The settings first, and on their own. They are not about any page, and
    // a popup that could not work out which page it was opened on must still
    // show them — the alternative is a popup with a title and nothing else,
    // and no way to reach a setting that has nothing to do with the tab.
    setSettings(await loadSettings());

    const key = await addressInFront();
    if (key) {
      setDetection((await readDetection(key)) ?? null);

      // A record read once is a record about to be out of date: the content
      // script writes a new one whenever it reads the page again, which is
      // every time something here is changed. Read once, the line this popup
      // exists for would go on describing the page as it was before the
      // reader touched it.
      onCleanup(watchDetection(key, setDetection));
    }

    // Here rather than in the content script, which runs on every page a
    // reader opens. Tidying belongs where somebody asked for something.
    await pruneDetections();
  });

  const update = async (next: Settings) => {
    setSettings(next);
    await saveSettings(next);
  };

  /** The key set for this chart, as the chart is being shown. */
  const override = (): Key | null => {
    const current = settings();
    const found = detection();
    return current && found ? overrideFor(current, found.pageId, found.transposeOffset) : null;
  };

  const canOverride = (): boolean => {
    const found = detection();
    if (!found || found.statedKeys > MOST_STATED_KEYS_TO_OVERRIDE) return false;

    // A key is kept as the key of the untransposed chart, so setting one
    // needs to know how far the chart has been transposed. Where the page
    // does not say, there is nothing to offer: a control that took a key and
    // saved none would leave a reader looking at a key they had chosen and a
    // page that had never heard of it.
    return found.transposeOffset !== null;
  };

  const setOverride = async (tonic: string, mode: Mode) => {
    const current = settings();
    const found = detection();
    const note = parseNote(tonic);
    if (!current || !found || !note || found.transposeOffset === null) return;

    await update(
      withOverride(current, found.pageId, { tonic: note, mode }, found.transposeOffset, Date.now()),
    );
  };

  const clearOverride = async () => {
    const current = settings();
    const found = detection();
    if (current && found) await update(withoutOverride(current, found.pageId));
  };

  return (
    <main class={styles.popup}>
      <h1 class={styles.title}>Degreeify</h1>

      <Show when={settings()}>
        {(current) => (
          <>
            {/*
             * Outside what is known about the page, because it is not about
             * the page. A reader who switched the names off, or who is on a
             * chart whose content script has not written its record yet, has
             * to be able to switch them back on — and this is the control
             * they came for.
             */}
            <label class={styles.row}>
              <input
                type="checkbox"
                checked={current().enabled}
                onChange={(event) =>
                  void update({ ...current(), enabled: event.currentTarget.checked })
                }
              />
              <span>Show degree names</span>
            </label>

            <Show
              when={detection()}
              fallback={<p class={styles.note}>Open a ChordWiki chord chart to use Degreeify.</p>}
            >
              {(found) => (
                <>
                  <p class={styles.reading}>{reading(found(), current().enabled)}</p>

                  <Show when={found().unreadKeys > 0}>
                    <p class={styles.warning}>
                      {found().unreadKeys} of {found().statedKeys} key declarations could not be
                      read. Those sections are left as the chart wrote them.
                    </p>
                  </Show>

                  <Show
                    when={canOverride()}
                    fallback={<p class={styles.note}>{whyNotOverridable(found())}</p>}
                  >
                    <div class={styles.row}>
                      <label class={styles.field}>
                        <span>Key</span>
                        <select
                          value={override() ? formatNoteOf(override()) : ''}
                          onChange={(event) => {
                            const tonic = event.currentTarget.value;
                            if (tonic) void setOverride(tonic, override()?.mode ?? 'major');
                            else void clearOverride();
                          }}
                        >
                          <option value="">Read from the chart</option>
                          <For each={CANONICAL_TONIC[override()?.mode ?? 'major']}>
                            {(tonic) => <option value={tonic}>{tonic}</option>}
                          </For>
                        </select>
                      </label>

                      <label class={styles.field}>
                        <span>Mode</span>
                        <select
                          value={override()?.mode ?? 'major'}
                          disabled={!override()}
                          onChange={(event) => {
                            const mode = event.currentTarget.value as Mode;
                            const tonic = override();
                            if (tonic) void setOverride(formatNoteOf(tonic), mode);
                          }}
                        >
                          <option value="major">major</option>
                          <option value="minor">minor</option>
                        </select>
                      </label>
                    </div>

                    <button
                      type="button"
                      disabled={!override()}
                      onClick={() => void clearOverride()}
                    >
                      Use the chart's own key
                    </button>
                  </Show>
                </>
              )}
            </Show>

            <label class={styles.field}>
              <span>Numerals</span>
              <select
                value={current().notation}
                onChange={(event) =>
                  void update({ ...current(), notation: event.currentTarget.value as Notation })
                }
              >
                <option value="roman-ascii">I II III (fixed width)</option>
                <option value="roman-unicode">Ⅰ Ⅱ Ⅲ (one character)</option>
              </select>
            </label>

            <label class={styles.field}>
              <span>Spelling</span>
              <select
                value={current().spelling}
                onChange={(event) =>
                  void update({
                    ...current(),
                    spelling: event.currentTarget.value as SpellingPolicy,
                  })
                }
              >
                <option value="canonical">Consistent</option>
                <option value="source">As the chart spells it</option>
              </select>
            </label>
          </>
        )}
      </Show>
    </main>
  );
}

/**
 * The address of the page the popup was opened over, if it has one.
 *
 * Nothing, for every way of not being on a chart: a tab this extension has no
 * permission for, which reports no address at all; a page on the site that is
 * not a chart, which no content script wrote a record for; a chart opened a
 * moment ago whose content script has not run yet. They are one state to a
 * reader — nothing to say about this page yet — and one state here.
 *
 * Including when asking throws. A popup is opened over whatever a reader
 * happens to be looking at, and one that throws while working out where it is
 * renders nothing at all: no key, no toggle, and no way to reach the settings
 * that were never about the page.
 */
async function addressInFront(): Promise<string | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return recordKey(tab?.url);
  } catch {
    return null;
  }
}

/** What the popup says about the key a chart was read in. */
function reading(found: Detection, enabled: boolean): string {
  if (!found.key) {
    return found.statedKeys > 0
      ? 'This chart states a key this could not read.'
      : 'This chart states no key, and its chords do not settle one.';
  }

  const key = `${found.key.tonic}${found.key.mode === 'minor' ? 'm' : ''}`;
  const where =
    found.source === 'page'
      ? 'from the chart'
      : found.source === 'manual'
        ? 'set by hand'
        : 'guessed from the chords';
  const sections = found.statedKeys > 1 ? `, ${found.statedKeys} sections` : '';

  // What the page says, and not what it would say. The chart is read whether
  // or not the names are shown, so with them off this count is of names that
  // are not on the page — and a reader looking at a chart in chord names,
  // told that six chords are named, would be right to wonder which six.
  const chords = enabled ? `${found.named} chords named.` : `${found.named} chords would be named.`;

  return `${key} — ${where}${sections}. ${chords}`;
}

/**
 * Why the key cannot be set for this chart, which is not always the same
 * reason.
 */
function whyNotOverridable(found: Detection): string {
  return found.statedKeys > MOST_STATED_KEYS_TO_OVERRIDE
    ? `This chart states ${found.statedKeys} keys, so it cannot be read in one key set by hand.`
    : 'This page does not say how far the chart has been transposed, so a key set here could not be kept.';
}

function formatNoteOf(key: Key | null): string {
  return key ? formatKey({ ...key, mode: 'major' }) : '';
}

export default App;
