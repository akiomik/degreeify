import {
  createEffect,
  createSignal,
  For,
  getOwner,
  onCleanup,
  onMount,
  runWithOwner,
  Show,
} from 'solid-js';
import { browser } from 'wxt/browser';
import { MOST_STATED_KEYS_TO_OVERRIDE } from '@/content/apply';
import type { SpellingPolicy } from '@/core/degree';
import { CANONICAL_TONIC, type Key, type Mode } from '@/core/key';
import type { Notation } from '@/core/notation';
import { formatNote, parseNote } from '@/core/pitch';
import {
  type Kept,
  overrideFor,
  usableOffset,
  withOverride,
  withoutOverride,
} from '@/settings/overrides';
import {
  DEFAULT_SETTINGS,
  type Detection,
  type KeyOverride,
  loadSettings,
  loadStamps,
  pruneDetections,
  readDetection,
  readSettings,
  recordKey,
  type Settings,
  saveKept,
  watchDetection,
} from '@/settings/storage';
import styles from './App.module.css';

function App() {
  const [settings, setSettings] = createSignal<Settings | null>(null);
  const [detection, setDetection] = createSignal<Detection | null>(null);

  // Which mode the tonics on offer are named for, whether or not a key has
  // been set yet. Without it a reader wanting F# minor would have to set a
  // major key first — rewriting the whole page against a tonic they did not
  // mean — and three tonics would never be offered at all, since the two
  // modes do not name the same pitches the same way.
  const [pendingMode, setPendingMode] = createSignal<Mode>('major');

  const [failed, setFailed] = createSignal(false);

  /**
   * Whether what is stored is settings this build can write over.
   *
   * A reader who has been on a later build and come back to this one has
   * settings this one reads as the defaults. Offering the controls would be
   * offering to write those defaults over everything they had.
   */
  const [readable, setReadable] = createSignal(true);

  /**
   * Whether the settings could not be read at all.
   *
   * The controls still work — a change reads again before it writes, and that
   * read may well succeed — but what they show until then is this build's
   * defaults rather than the reader's answers, and a control showing
   * something nobody chose has to say so.
   */
  const [unread, setUnread] = createSignal(false);

  // What is stored is what was chosen, once it has arrived. A key loaded from
  // storage brings its mode with it, and the control has to show that mode
  // rather than whichever one this happened to start on.
  createEffect(() => {
    const found = override();
    if (found) setPendingMode(found.mode);
  });

  onMount(async () => {
    // Held on to before anything is awaited. Solid knows which component a
    // cleanup belongs to only while the call stack is still inside it, and
    // the first `await` below leaves it — a cleanup registered after that
    // belongs to nobody and is never run.
    const owner = getOwner();

    // The settings first, and on their own. They are not about any page, and
    // a popup that could not work out which page it was opened on must still
    // show them — the alternative is a popup with a title and nothing else,
    // and no way to reach a setting that has nothing to do with the tab.
    //
    // Which is also why the read cannot be allowed to throw: it gates the
    // whole of the rest of this. A storage read that fails — an extension
    // reloaded out from under an open popup — would leave a heading and
    // nothing else, which is the state `addressInFront` is wrapped against
    // three lines down.
    // Everything about the settings before any of it is shown. Shown a piece
    // at a time, the popup paints its controls and takes them away a moment
    // later — and a reader who clicked inside that moment is told their
    // change could not be saved rather than told why it was never going to
    // be.
    const stored = await readSettings().catch(() => null);

    setReadable(!stored?.fromLater);

    // Not read, whether the read failed or what came back was not settings.
    // Both leave the controls showing this build's defaults rather than the
    // reader's answers, and a control showing something nobody chose is worse
    // for being indistinguishable from one showing an answer.
    setUnread(!stored?.understood);
    // The same fallback the page uses for the same failure. Read as the plain
    // defaults, the checkbox would say the names are on while no page is
    // naming anything — one failure answered two ways, and the one the reader
    // can see would be the wrong one.
    //
    // Only where the read itself failed. Settings that were read and were not
    // settings show as the defaults, which is what they are and what the line
    // above them says: the page leaves itself alone over them, and that is
    // the page's business rather than a value to be shown as an answer and
    // written back as one.
    setSettings(stored?.settings ?? { ...DEFAULT_SETTINGS, enabled: false });

    const key = await addressInFront();
    if (key) {
      // Listening before reading, for the reason the content script does:
      // the record may be written between the read being asked for and its
      // answer arriving. A reader who opens the popup while a chart is still
      // loading would otherwise be told there is no chart here, and told it
      // for as long as the popup stays open.
      //
      // A record read once is out of date the moment the page is read again,
      // which is every time something here is changed.
      // Wrapped like everything else here. This is the last thing that could
      // throw before the record is read, and a throw would leave the popup
      // saying there is no chart here on a chart — while doing without the
      // watching costs only a line that goes stale.
      try {
        const stop = watchDetection(key, setDetection);
        if (owner) runWithOwner(owner, () => onCleanup(stop));
        else stop();
      } catch {
        // Nothing to undo: a listener that could not be added is not one.
      }

      const found = await readDetection(key).catch(() => null);

      // Only where nothing has arrived in the meantime. What the watcher
      // heard is newer than what the read was sent to fetch.
      setDetection((current) => current ?? found);
    }

    // Here rather than in the content script, which runs on every page a
    // reader opens. Tidying belongs where somebody asked for something.
    await pruneDetections(undefined, key).catch(() => {});
  });

  /**
   * Changes a setting, and shows what was actually kept.
   *
   * One at a time. Every change here reads, alters and writes, and two of
   * those overlapping both read the same thing and the second writes over the
   * first — a reader who chose numerals and then spelling before the first
   * write landed would find the numerals back as they were, with nothing to
   * say so. Controls are two clicks apart; the window is a storage round
   * trip.
   *
   * Read again before writing rather than written from what the popup is
   * holding. It holds its copy for as long as it is open, and a page can
   * write in that time.
   *
   * Written before shown, because a control showing a setting that was not
   * kept is a reader told their answer was taken when it was not. Where the
   * write fails there is nothing to show but that it failed.
   */
  let writing: Promise<void> = Promise.resolve();

  const update = (change: (kept: Kept) => Kept) => {
    const next = async () => {
      try {
        const [settings, stamps] = await Promise.all([loadSettings(), loadStamps()]);
        const changed = change({ settings, stamps });

        await saveKept(changed.settings, changed.stamps, stamps);

        setSettings(changed.settings);
        setFailed(false);

        // What is stored is now what this build wrote, whatever it was
        // before. Left standing, the line saying the settings could not be
        // read goes on saying it about settings the reader has just replaced
        // — which reads as the change not having taken.
        setUnread(false);
      } catch {
        setFailed(true);

        // And the controls put back to what is kept. A checkbox a reader
        // clicked shows what they clicked until something says otherwise, and
        // nothing here has changed — so the same settings are handed back
        // under a new identity, which is what makes the controls read them
        // again.
        setSettings((shown) => (shown ? { ...shown } : shown));
      }
    };

    // On both sides, so that one failure does not leave every change after it
    // skipped over a chain that has already rejected.
    writing = writing.then(next, next);
    return writing;
  };

  /** The key set for this chart, as the chart is being shown. */
  const override = (): Key | null => {
    const current = settings();
    const found = detection();
    return current && found ? overrideFor(current, found.pageId, found.transposeOffset) : null;
  };

  /**
   * The mode the tonics are being named for.
   *
   * What the reader last chose, and not what is stored. A mode change is a
   * write, and a write takes a moment: asked of the key in force, the control
   * would read one mode while the tonics beside it were the other's, and a
   * tonic picked in between would be saved in the mode the reader had just
   * moved away from.
   */
  const mode = (): Mode => pendingMode();

  /**
   * The tonic the control is showing, out of the ones it is offering.
   *
   * Asked about the list as well as about the key, which is what makes it be
   * asked again when the list changes. A `select` cannot show a value it has
   * no option for: the mode arrives from storage after the first paint, the
   * options are swapped for the other mode's, and a value applied while the
   * major ones were up quietly became nothing. `F#`, `C#` and `G#` name
   * minor keys and no major one, so a reader with one of those set was told
   * their key was read from the chart while the line above said otherwise.
   */
  const chosenTonic = (): string => {
    const offered = CANONICAL_TONIC[mode()];
    const found = override();
    const name = found ? formatNoteOf(found) : '';

    return offered.includes(name) ? name : '';
  };

  const canOverride = (): boolean => {
    const found = detection();
    if (!found || found.statedKeys > MOST_STATED_KEYS_TO_OVERRIDE) return false;

    // A key is kept as the key of the untransposed chart, so setting one
    // needs to know how far the chart has been transposed. Asked with the
    // same question the key will be read with, so that a control cannot offer
    // to keep something the page will then refuse.
    return usableOffset(found.transposeOffset);
  };

  const setOverride = async (tonic: string, mode: Mode) => {
    const found = detection();
    const note = parseNote(tonic);
    if (!found || !note || !usableOffset(found.transposeOffset)) return;

    const { pageId, transposeOffset } = found;
    await update((kept) =>
      withOverride(kept, pageId, { tonic: note, mode }, transposeOffset, Date.now()),
    );
  };

  const clearOverride = async () => {
    const found = detection();
    const current = settings();

    // Nothing to clear is nothing to write. Written anyway, a reader choosing
    // "read from the chart" on a chart that was already being read from tells
    // every open tab that the settings changed, over a change that is not
    // one — and can be told the write failed for their trouble.
    if (!found || !current || !keptFor(current, found.pageId)) return;

    // The mode the key was in stays on offer. A reader clearing a key to
    // choose another tonic in the same mode would otherwise find the control
    // back on major and three of the minor tonics gone from the list — and
    // the next tonic they chose saved as a major key.
    const cleared = override();
    if (cleared) setPendingMode(cleared.mode);

    await update((kept) => withoutOverride(kept, found.pageId));
  };

  return (
    <main class={styles.popup}>
      <h1 class={styles.title}>Degreeify</h1>

      <Show
        when={readable()}
        fallback={
          <p class={styles.warning}>
            These settings were written by a newer version of Degreeify. Update it to change them.
          </p>
        }
      >
        <Show when={settings()}>
          {(current) => (
            <>
              <Show when={failed()}>
                <p class={styles.warning}>That could not be saved. Nothing has changed.</p>
              </Show>

              <Show when={unread()}>
                <p class={styles.warning}>
                  Your settings could not be read. These are the defaults, not your answers.
                </p>
              </Show>

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
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    void update(({ settings, stamps }) => ({
                      settings: { ...settings, enabled },
                      stamps,
                    }));
                  }}
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

                    {/*
                     * Only where the chart's own declarations are what was
                     * followed. A key from outside — set by hand, or guessed
                     * from the chords — stands in for the line that could not
                     * be read, and the chart is named end to end; saying a
                     * section was left alone would be false, and would sit
                     * directly under a count of the chords that were named.
                     */}
                    <Show when={found().unreadKeys > 0 && found().source === 'page'}>
                      <p class={styles.warning}>
                        {found().unreadKeys} of {found().statedKeys} key declarations could not be
                        read. Those sections are left as the chart wrote them.
                      </p>
                    </Show>

                    <Show
                      when={canOverride()}
                      fallback={
                        <>
                          <p class={styles.note}>{whyNotOverridable(found())}</p>

                          {/*
                           * A key already set is still set, and this is the
                           * only thing that can remove it. A chart edited to
                           * declare a second key, or a page that stops saying
                           * how far it has been transposed, would otherwise
                           * leave a reader with a key they cannot reach —
                           * inert, but taking a place among the ones kept.
                           *
                           * Asked of the key that is kept rather than of the
                           * key in force. No key is in force on a page that
                           * does not say how far it has been transposed, which
                           * is one of the two cases this is here for — asked
                           * the other way, the escape hatch is missing from
                           * half of what it is an escape from.
                           */}
                          <Show when={keptFor(current(), found().pageId)}>
                            <button type="button" onClick={() => void clearOverride()}>
                              Forget the key set for this chart
                            </button>
                          </Show>
                        </>
                      }
                    >
                      <div class={styles.row}>
                        <label class={styles.field}>
                          <span>Key</span>
                          <select
                            value={chosenTonic()}
                            onChange={(event) => {
                              const tonic = event.currentTarget.value;
                              if (tonic) void setOverride(tonic, mode());
                              else void clearOverride();
                            }}
                          >
                            <option value="">Read from the chart</option>
                            <For each={CANONICAL_TONIC[mode()]}>
                              {(tonic) => <option value={tonic}>{tonic}</option>}
                            </For>
                          </select>
                        </label>

                        <label class={styles.field}>
                          <span>Mode</span>
                          <select
                            value={mode()}
                            onChange={(event) => {
                              const chosen = event.currentTarget.value as Mode;
                              setPendingMode(chosen);

                              // Where a key is already set, changing the mode
                              // changes it. Where none is, this is a choice
                              // about which tonics to offer and nothing has
                              // been asked for yet.
                              const current = override();
                              if (current) void setOverride(formatNoteOf(current), chosen);
                            }}
                          >
                            <option value="major">major</option>
                            <option value="minor">minor</option>
                          </select>
                        </label>
                      </div>

                      {/*
                       * Offered whenever a key is kept, and not only when one
                       * is in force. A key stored in some shape this cannot
                       * read is a key that does nothing and cannot be removed
                       * — which is the only kind a reader would most want to
                       * be rid of.
                       */}
                      <button
                        type="button"
                        disabled={!keptFor(current(), found().pageId)}
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
                  onChange={(event) => {
                    const notation = event.currentTarget.value as Notation;
                    void update(({ settings, stamps }) => ({
                      settings: { ...settings, notation },
                      stamps,
                    }));
                  }}
                >
                  <option value="roman-ascii">I II III (fixed width)</option>
                  <option value="roman-unicode">Ⅰ Ⅱ Ⅲ (one character)</option>
                </select>
              </label>

              <label class={styles.field}>
                <span>Spelling</span>
                <select
                  value={current().spelling}
                  onChange={(event) => {
                    const spelling = event.currentTarget.value as SpellingPolicy;
                    void update(({ settings, stamps }) => ({
                      settings: { ...settings, spelling },
                      stamps,
                    }));
                  }}
                >
                  <option value="canonical">Consistent</option>
                  <option value="source">As the chart spells it</option>
                </select>
              </label>
            </>
          )}
        </Show>
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
    if (found.statedKeys === 0)
      return 'This chart states no key, and its chords do not settle one.';

    // Counted, because a chart that changes key states one line per section
    // and this is the only place the reader is told how much of it went
    // unread — the warning below is for a chart that was named in spite of a
    // line, and this is a chart that was not named at all.
    return found.unreadKeys > 1
      ? `This chart states ${found.statedKeys} keys, and ${found.unreadKeys} of them could not be read.`
      : 'This chart states a key this could not read.';
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

/**
 * The key kept for a chart, asked of the object itself.
 *
 * `in` and a bare lookup both find a `constructor` on any object, and what is
 * looked up here is a chart's name — which carries an adapter's prefix today
 * and need not tomorrow. Asked either of those ways, a chart called
 * `constructor` would have a key nobody set and a button to forget it.
 */
function keptFor(settings: Settings, pageId: string): KeyOverride | undefined {
  return Object.hasOwn(settings.keyOverrides, pageId) ? settings.keyOverrides[pageId] : undefined;
}

/** The tonic on its own, which is what the control offers and keeps. */
function formatNoteOf(key: Key | null): string {
  return key ? formatNote(key.tonic) : '';
}

export default App;
