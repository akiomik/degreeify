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
import type { SpellingPolicy } from '@/core/degree';
import { CANONICAL_TONIC, type Key, MOST_STATED_KEYS_TO_OVERRIDE, type Mode } from '@/core/key';
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
  asked,
  DEFAULT_SETTINGS,
  type Detection,
  type KeyStamps,
  loadSettings,
  loadStamps,
  MOST_DETECTIONS,
  pruneDetections,
  RETRY_AFTER,
  readDetection,
  readSettings,
  recordKey,
  type Settings,
  type StoredSettings,
  saveKept,
  watchDetection,
  watchSettings,
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
   * Whether what is stored is not settings this build can read.
   *
   * The controls still work — a change reads again before it writes, and that
   * read may well succeed — but what they show until then is this build's
   * defaults rather than the reader's answers, and a control showing
   * something nobody chose has to say so.
   *
   * It has to say one more thing, because two true things about this state
   * disagree with each other on the face of it: no chart is being named, and
   * the defaults say to name every one. The first is what the checkbox shows,
   * so a reader who wants the names has one click rather than two; the second
   * is what any change here writes, so changing the numerals turns the names
   * on as well. Neither is wrong and the pair is surprising, so the line says
   * what will happen rather than leaving it to be found out.
   *
   * Every page reads the same stored value and answers it the same way, which
   * is what lets this speak for the charts as well as for the controls.
   */
  const [unread, setUnread] = createSignal(false);

  /**
   * Whether this popup's own read failed, which is a different thing.
   *
   * Kept apart from {@link unread} because only one of the two says anything
   * about the charts. A read that throws here says nothing about the read a
   * content script made a moment earlier: that one may well have worked, and
   * the chart behind this popup may be named end to end. Told that no chart
   * is being named, a reader looking at one that is would be right to stop
   * believing the rest of this.
   */
  const [unreachable, setUnreachable] = createSignal(false);

  /**
   * Whether the popup is still working out what page it was opened over.
   *
   * Which takes two round trips — the address of the tab, then the record
   * written for it — and both land after the settings, which are asked for
   * first and on their own. Without this there is nothing to tell "not a
   * chart" from "still asking", and every popup opened over a chart says
   * there is no chart here before it says otherwise. Said and taken back
   * inside a frame is still said.
   */
  const [looking, setLooking] = createSignal(true);

  /**
   * How many times the watcher has spoken about the settings.
   *
   * Read before a read is asked for and again when it answers. The watcher is
   * registered before the first read for the race it is here for — a newer
   * build, or another window, writing between the asking and the answer — and
   * without this the answer to the older question lands last and wins. The
   * popup would go back to offering controls that cannot be saved, which is
   * the thing the watching was added to stop.
   */
  let heard = 0;

  /** Whether the mode on offer is one the reader has settled, one way or another. */
  let modeIsSettled = false;

  /** Which mode change is the latest, so that an older one cannot undo it. */
  let modeChanges = 0;

  // Held on to before anything is awaited. Solid knows which component a
  // cleanup belongs to only while the call stack is still inside it, and the
  // first `await` in anything below leaves it — a cleanup registered after
  // that belongs to nobody and is never run.
  const owner = getOwner();

  /** Where the record for the page in front is kept, once that is known. */
  let where: string | null = null;

  /**
   * Whether the address of the page in front could not be asked for.
   *
   * Told apart from there being no chart address, which is what a reader on
   * any other page has. Both leave the popup with nothing to say about a
   * page; only one of them is worth asking about again.
   */
  const [unplaced, setUnplaced] = createSignal(false);

  /**
   * Takes the page in front to be the one at `key`, and listens for its
   * record changing.
   *
   * Listening before reading, for the reason the content script does: the
   * record may be written between the read being asked for and its answer
   * arriving. A reader who opens the popup while a chart is still loading
   * would otherwise be told there is no chart here, and told it for as long
   * as the popup stays open.
   *
   * A record read once is out of date the moment the page is read again,
   * which is every time something here is changed.
   */
  /**
   * Starts listening, and arranges for it to stop with the popup.
   *
   * Wrapped, because doing without the watching costs a line that goes stale
   * and throwing costs whatever was going to be read next — a popup that
   * threw here would say there is no chart here on a chart.
   */
  const listen = (start: () => () => void) => {
    try {
      const stop = start();
      if (owner) runWithOwner(owner, () => onCleanup(stop));
      else stop();
    } catch {
      // Nothing to undo: a listener that could not be added is not one.
    }
  };

  const place = (key: string) => {
    where = key;
    setLost(true);

    listen(() =>
      watchDetection(key, (found) => {
        // Nothing missing any more, whatever became of the read. A record
        // that arrives on its own is a record, and asking again for one the
        // popup is already showing is three round trips whose answers it
        // would throw away.
        setLost(false);
        setDetection(found);
      }),
    );
  };

  /**
   * Shows what a read of the settings came back with, or that it failed.
   *
   * Told apart, because they leave the charts in different states. Both leave
   * the controls showing this build's defaults rather than the reader's
   * answers, and a control showing something nobody chose is worse for being
   * indistinguishable from one showing an answer — but only a stored value no
   * build here can read is one every page is answering the same way.
   *
   * The settings themselves get the same fallback the page uses for the same
   * failure. Read as the plain defaults, the checkbox would say the names are
   * on while no page is naming anything — one failure answered two ways, and
   * the one the reader can see would be the wrong one. As every page is
   * acting on them, which for a stored value none of them can read is with
   * the names off: shown plainly, the checkbox would say the names are on
   * while no chart anywhere is named, and the reader's first click would turn
   * them off again, so it would take two to turn them on.
   *
   * For a read that threw it is a guess rather than a reading: the pages made
   * their own reads and this one says nothing about them. It is the guess
   * whose recovery is one click, and the warning it raises says which of the
   * two states this is.
   *
   * What is written still starts from what was read rather than from this. A
   * value nobody chose, sitting where a setting goes, is one the next write
   * takes for an answer.
   */
  const settle = (stored: StoredSettings | null) => {
    setReadable(!stored?.fromLater);
    setUnreachable(stored === null);
    setUnread(stored !== null && !stored.understood);
    setSettings(stored ? asked(stored) : { ...DEFAULT_SETTINGS, enabled: false });
  };

  /** Tries spent on whatever is outstanding, and the one waiting to be. */
  let tries = 0;
  let waiting: ReturnType<typeof setTimeout> | null = null;

  /**
   * Arms the next try where anything the popup opened needing is outstanding.
   *
   * One at a time, and only after the try before it has answered. Fired from
   * a single instant, three tries against a storage that is merely slow are
   * three answers to the first question rather than three attempts at it.
   *
   * A popup is open for seconds rather than for the life of a tab, so the
   * tries that matter are the early ones; the last is there for a reader who
   * leaves it open while whatever broke storage sorts itself out.
   */
  /**
   * Whether the popup has gone, so that nothing arms a try for a dead one.
   *
   * The cleanup clears the timer that is waiting, and a try already in flight
   * has no timer to clear — its continuation arms the next one, on a root
   * that is not there any more. In a popup the document goes with it and
   * nothing comes of it; in anything that outlives its root, it is storage
   * reads and signal writes against something disposed.
   */
  let gone = false;

  const tryAgainIfNeeded = () => {
    if (gone) return;

    // A record that has not arrived is outstanding too, where the popup knows
    // where one would be. `watchDetection` is what normally brings it, and a
    // listener that could not be added is a listener that hears nothing — on
    // a chart still being read, that is the line the popup exists for, gone
    // for as long as it stays open. Bounded like the rest: three tries, and
    // on a page that will never have a record they cost three reads.
    const waited = where !== null && !detection();

    if (!unreachable() && !lost() && !unplaced() && !waited && tidied) {
      tries = 0;
      return;
    }
    if (waiting !== null) return;

    const after = RETRY_AFTER[tries];

    // And says so where they are spent. Left looking, a popup that never
    // worked out which tab it was over shows a heading, the settings, and a
    // gap where everything about the page goes — with nothing to say whether
    // it is still asking, gave up, or is simply not on a chart.
    if (after === undefined) {
      setLooking(false);
      return;
    }

    tries++;
    waiting = setTimeout(() => {
      waiting = null;
      void reread().then(tryAgainIfNeeded, tryAgainIfNeeded);
    }, after);
  };

  onCleanup(() => {
    gone = true;
    if (waiting !== null) clearTimeout(waiting);
  });

  /** Whether the records have been tidied, which is once per popup. */
  let tidied = false;

  /**
   * Drops the oldest records, keeping the one for the page in front.
   *
   * Here rather than in the content script, which runs on every page a reader
   * opens. Tidying belongs where somebody asked for something.
   *
   * Not until the popup knows which page that is. Run without it, the record
   * it is about to read is not the one being kept — and a reader who has
   * browsed enough charts since has this one dropped by the popup they opened
   * to look at it, after which it says to open a chord chart on the chord
   * chart in front of them. A page normally writes its record straight back,
   * but the failure that loses the address is an extension reloaded out from
   * under everything, which is the failure that takes the page's listeners
   * with it.
   */
  const tidy = async () => {
    if (tidied || unplaced()) return;

    // And spent only once it has been done, for the reason the page spends
    // its own that way: a walk of the store that would not answer is not a
    // tidying, and taking it for one leaves the popup — which is where the
    // tidying belongs — never doing it, so the records stay over the number
    // they are held to until the next one opens.
    // The whole number, and no place held open for a record that has not
    // arrived. One was, for the page whose content script is still reading it
    // — a real case, and the store sits one over the number from the moment
    // that record lands until something sweeps again.
    //
    // But nothing here can tell that page from a page on the site that is not
    // a chart. A popup has the address of the tab and nothing else, and every
    // page on the site has an address that looks like a chart's, so holding a
    // place open guesses — and guessing wrong drops the oldest chart a reader
    // has read for a record that is never written. One over a number this
    // project sets itself, until the next popup or the next page load, is the
    // cheaper of the two.
    tidied = await pruneDetections(MOST_DETECTIONS, where).then(
      () => true,
      () => false,
    );
  };

  /**
   * Reads the record for the page in front, where there is one to read.
   *
   * A read that answers settles it whatever the answer is: a chart address
   * whose content script has not written a record yet is covered by the
   * watching, and one that never will is a page this has nothing to say
   * about. Only a read that failed is asked again.
   */
  const fetchRecord = async () => {
    if (!where) return;

    try {
      const found = await readDetection(where);
      setLost(false);

      // Only where nothing has arrived in the meantime. What the watcher
      // heard is newer than what the read was sent to fetch.
      setDetection((current) => current ?? found);
    } catch {
      // Left to be asked again.
    }
  };

  /**
   * Whether the record for that page could not be read.
   *
   * Told apart from there being none, in what is asked again and in what is
   * shown. A page that is not a chart has no record and never will, so asking
   * again would be asking about nothing and "open a chord chart" is the truth
   * about it. A read that failed is a chart the popup has been told nothing
   * about, and that sentence would be a guess — on a chart that may well be
   * named end to end.
   */
  const [lost, setLost] = createSignal(false);

  // What is stored is what was chosen, once it has arrived: a key loaded from
  // storage brings its mode with it, and the control has to show that mode
  // rather than whichever one this happened to start on.
  //
  // Once, and not on every reading. This runs again whenever what was found
  // on the page changes, which a page writes for reasons of its own — and a
  // reader who has just chosen a mode has not had that choice written yet,
  // so the reading would put the control back where they moved it from and
  // save the next tonic they picked in the mode they had left.
  createEffect(() => {
    const found = override();
    if (!found || modeIsSettled) return;

    modeIsSettled = true;
    setPendingMode(found.mode);
  });

  onMount(async () => {
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
    // Listening before reading, for the reason the record is: a newer build,
    // or another tab, can write between this read being asked for and its
    // answer arriving. Read once, a popup left open while a newer build
    // writes goes on offering controls that cannot be saved — and the reader
    // is told their change could not be saved rather than told why it was
    // never going to be.
    listen(() =>
      watchSettings((changed) => {
        heard++;
        setReadable(!changed.fromLater);
        setUnread(!changed.understood);
        setUnreachable(false);
        setSettings(asked(changed));
      }),
    );

    const said = heard;
    const stored = await readSettings().catch(() => null);

    // Unless the watcher has spoken in the meantime, in which case it heard
    // something newer than this was sent to fetch.
    if (heard === said) {
      settle(stored);
    }

    let key: string | null = null;
    try {
      key = await addressInFront();
    } catch {
      // Asked again below, like the reads. Left as no chart, a popup that
      // could not work out which tab it was over would say there is no chart
      // here on a chart, hide the whole key control, and never ask again.
      setUnplaced(true);
    }

    if (key) {
      place(key);
      await fetchRecord();
    }

    // Whatever came of it, so long as it was asked and answered. A chart
    // whose content script has not written a record yet has none to show, and
    // telling its reader to open a chord chart is what the popup has to say
    // until one arrives — saying it before asking is what this is about. A
    // page this could not place has not been asked about, and one whose
    // record would not read has been asked and told nothing.
    if (!unplaced() && !lost()) setLooking(false);

    await tidy();

    tryAgainIfNeeded();
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

  /**
   * Runs `work` after everything else this popup has asked storage for.
   *
   * On both sides, so that one failure does not leave every change after it
   * skipped over a chain that has already rejected.
   */
  const inTurn = <T,>(work: () => Promise<T>): Promise<T> => {
    const done = writing.then(work, work);
    writing = done.then(
      () => undefined,
      () => undefined,
    );
    return done;
  };

  /**
   * Reads the settings again where the read this popup opened with failed.
   *
   * That read gates everything: the controls show this build's defaults, and
   * the ones about the key are switched off outright, because a key nothing
   * could read is a key nothing knows about. Nothing else would ask again —
   * a change reads before it writes, but the controls that would forget a key
   * are the ones the failed read disabled — so a reader whose chart is named
   * in a key they set by hand is looking at a popup that says the key came
   * from the chart, with nothing to press.
   *
   * In turn with the writes, so that an answer arriving in the middle of a
   * change cannot put the controls back to what they showed before it.
   */
  const reread = () =>
    inTurn(async () => {
      if (unreachable()) {
        const said = heard;
        const stored = await readSettings().catch(() => null);

        // And only where the watcher has not spoken in the meantime, which is
        // the race the first read is guarded against for the same reason.
        if (stored && heard === said) settle(stored);
      }

      // Which page this is, where that could not be asked. Nothing can be
      // read about a page the popup cannot place, so this comes before the
      // record and settles whether there is one to read at all.
      if (unplaced()) {
        try {
          const key = await addressInFront();

          // Asked and answered, whatever the answer was. A tab with no chart
          // address is not going to grow one while the popup is open.
          setUnplaced(false);
          if (key) place(key);
        } catch {
          // Still nothing to place it by.
        }
      }

      // The record as well, which the same failure takes and which nothing
      // else would ask for again. The watcher fires when a record changes,
      // and a page that has written one has no reason to write it again — so
      // a popup that lost the read would go on saying to open a chord chart,
      // on the chord chart in front of the reader, for as long as it stayed
      // open. Once the settings arrive it would say it while looking
      // otherwise well.
      if (lost() || !detection()) await fetchRecord();

      // After both, the way the opening does it. Said in between, a page just
      // placed and being read is a page the popup is telling its reader it
      // could not find out about — `place` has it lost until the record
      // answers, which is exactly the round trip this would speak over.
      if (!unplaced() && !lost()) setLooking(false);

      // Last, because it was waiting on the address and because it is the one
      // thing here nobody is looking at.
      await tidy();
    });

  const update = (change: (kept: Kept) => Kept, stamped = true): Promise<boolean> => {
    const next = async () => {
      try {
        const [settings, stamps] = await Promise.all([
          loadSettings(),
          stamped ? loadStamps() : Promise.resolve<KeyStamps>({}),
        ]);
        const changed = change({ settings, stamps });

        await saveKept(changed.settings, changed.stamps, stamps);

        setSettings(changed.settings);
        setFailed(false);

        // What is stored is now what this build wrote, whatever it was
        // before, and it was read on the way there. Left standing, either
        // line saying the settings could not be read goes on saying it about
        // settings the reader has just replaced and this has just read —
        // which reads as the change not having taken.
        setUnread(false);
        setUnreachable(false);
        return true;
      } catch {
        setFailed(true);

        // And the controls put back to what is kept. A checkbox a reader
        // clicked shows what they clicked until something says otherwise, and
        // nothing here has changed — so the same settings are handed back
        // under a new identity, which is what makes the controls read them
        // again.
        setSettings((shown) => (shown ? { ...shown } : shown));
        return false;
      }
    };

    // Whether it was kept is handed back, because not everything a change
    // moves is in the settings: a control the popup drives itself has to be
    // put back by whoever moved it, and only this knows whether there is
    // anything to put back.
    return inTurn(next);
  };

  /**
   * Changes a setting that is not about the key kept for any chart.
   *
   * Without the stamps, which are read by walking the whole of storage —
   * every record and every stamp, up to a couple of hundred values — to hand
   * back untouched. `saveKept` writes the stamps that changed against the
   * ones that were read and removes the ones that went, and nothing against
   * nothing is neither, so a checkbox costs one write and no walk.
   *
   * The write side already had this: the comment on `saveKept` about not
   * writing two hundred keys for a checkbox is about the same click.
   */
  const changeSetting = (alter: (settings: Settings) => Settings): Promise<boolean> =>
    update(({ settings }) => ({ settings: alter(settings), stamps: {} }), false);

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

  const setOverride = async (tonic: string, mode: Mode): Promise<boolean> => {
    const found = detection();
    const note = parseNote(tonic);
    if (!found || !note || !usableOffset(found.transposeOffset)) return false;

    const { pageId, transposeOffset } = found;
    return update((kept) =>
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
    if (!found || !current || !anythingKeptFor(current, found.pageId)) return;

    // The mode the key was in stays on offer. A reader clearing a key to
    // choose another tonic in the same mode would otherwise find the control
    // back on major and three of the minor tonics gone from the list — and
    // the next tonic they chose saved as a major key.
    const cleared = override();
    if (cleared) {
      modeIsSettled = true;
      setPendingMode(cleared.mode);
    }

    await update((kept) => withoutOverride(kept, found.pageId));
  };

  return (
    <main class={styles.popup}>
      <h1 class={styles.title}>Degreeify</h1>

      {/*
       * Beside what is known about the page rather than in place of it. The
       * reading line, and the warnings around it, write nothing — a reader on
       * a chart whose settings came from a newer build can still be told what
       * the page did with them, and taking that away leaves them a sentence
       * about a version number and no idea whether their chart was named.
       */}
      <Show when={!readable()}>
        <p class={styles.warning}>
          These settings were written by a newer version of Degreeify. Update it to change them.
        </p>
      </Show>

      <Show when={settings()}>
        {(current) => (
          <>
            <Show when={failed()}>
              <p class={styles.warning}>That could not be saved. Nothing has changed.</p>
            </Show>

            {/*
             * Not alongside the one above, which says the same thing about
             * the same settings and says which build wrote them.
             */}
            <Show when={unread() && readable()}>
              <p class={styles.warning}>
                Your settings could not be read. These are the defaults, not your answers, and no
                chart is being named until you change something here — which replaces what is
                stored, including any keys you had set for charts.
              </p>
            </Show>

            {/*
             * Which says nothing about the charts, because this failure says
             * nothing about them: what a page is showing was decided by that
             * page's own read of the same settings, and that read is not this
             * one.
             */}
            <Show when={unreachable() && readable()}>
              <p class={styles.warning}>
                Your settings could not be read here. These are the defaults, not your answers. What
                any chart is showing is unchanged.
              </p>
            </Show>

            {/*
             * Outside what is known about the page, because it is not about
             * the page. A reader who switched the names off, or who is on a
             * chart whose content script has not written its record yet, has
             * to be able to switch them back on — and this is the control
             * they came for.
             */}
            <Show when={readable()}>
              <label class={styles.row}>
                <input
                  type="checkbox"
                  checked={current().enabled}
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    void changeSetting((settings) => ({ ...settings, enabled }));
                  }}
                />
                <span>Show degree names</span>
              </label>
            </Show>

            <Show
              when={detection()}
              fallback={
                <Show when={!looking()}>
                  {/*
                   * Which of the two it is. A tab that would not answer is not
                   * a tab with no chart on it, and once the asking has run out
                   * the difference is all the popup has to offer — one of them
                   * is worth reopening it for.
                   */}
                  <Show
                    when={unplaced() || lost()}
                    fallback={
                      /*
                       * Nothing yet rather than nothing here. A chart whose
                       * record has not arrived is not a page with no chart on
                       * it: a content script waits for the page's own font
                       * before it measures anything, which on a slow page is
                       * seconds, and this is a popup opened inside those
                       * seconds on the chart the reader is looking at.
                       *
                       * The two cannot be told apart from here. A popup has
                       * the address of the tab and nothing else, and every
                       * page on the site has an address that looks like a
                       * chart's — so the line says what is true of both, and
                       * the advice that is useful in one is left standing for
                       * the other.
                       */
                      <p class={styles.note}>
                        Nothing to show for this page yet — open a ChordWiki chord chart, or give
                        this one a moment.
                      </p>
                    }
                  >
                    <p class={styles.warning}>
                      Degreeify could not find out about this page. Close this and open it again.
                    </p>
                  </Show>
                </Show>
              }
            >
              {(found) => (
                <>
                  <p class={styles.reading}>{reading(found())}</p>

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

                  {/*
                   * And nothing where the settings could not be read, rather
                   * than the defaults' answer to a question about a key. The
                   * key set for this chart is in those settings, so a failed
                   * read shows no key set — under a line, read from the
                   * record the page wrote, saying the key was set by hand.
                   * The controls are the wrong half to trust: they know only
                   * what this popup could read, and the line knows what the
                   * page did. Back as soon as a read works.
                   */}
                  <Show when={readable() && !unreachable()}>
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
                          <Show when={anythingKeptFor(current(), found().pageId)}>
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
                              const mine = ++modeChanges;

                              modeIsSettled = true;
                              setPendingMode(chosen);

                              // Where a key is already set, changing the mode
                              // changes it. Where none is, this is a choice
                              // about which tonics to offer and nothing has
                              // been asked for yet.
                              const current = override();
                              if (!current) return;

                              // And put back where it was if that could not
                              // be kept. The settings roll themselves back;
                              // this control is the popup's own, so nothing
                              // else would — and a reader told that nothing
                              // changed would be looking at a mode that had.
                              //
                              // Put back from what is kept rather than from
                              // what this control read a moment ago, and only
                              // by the last change made. Writes are
                              // serialised, so two changes made before the
                              // first has landed roll back in the order they
                              // were made: the first puts back the mode from
                              // before it, and the second puts back the mode
                              // between the two. A reader whose changes were
                              // all refused would be left looking at a mode
                              // they never settled on — with the key reading
                              // "read from the chart" on a chart that still
                              // has one, its tonic not being among the ones
                              // that mode offers.
                              void setOverride(formatNoteOf(current), chosen).then((kept) => {
                                if (kept || modeChanges !== mine) return;

                                const stayed = override();
                                if (stayed) setPendingMode(stayed.mode);
                              });
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
                        disabled={!anythingKeptFor(current(), found().pageId)}
                        onClick={() => void clearOverride()}
                      >
                        Use the chart's own key
                      </button>
                    </Show>
                  </Show>
                </>
              )}
            </Show>

            <Show when={readable()}>
              <label class={styles.field}>
                <span>Numerals</span>
                <select
                  value={current().notation}
                  onChange={(event) => {
                    const notation = event.currentTarget.value as Notation;
                    void changeSetting((settings) => ({ ...settings, notation }));
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
                    void changeSetting((settings) => ({ ...settings, spelling }));
                  }}
                >
                  <option value="canonical">Consistent</option>
                  <option value="source">As the chart spells it</option>
                </select>
              </label>
            </Show>
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
 * Allowed to throw, which is not one of those. A popup is opened over
 * whatever a reader happens to be looking at, and one that cannot ask which
 * tab that is has been told nothing rather than told there is no chart —
 * answered the same way, it would say there is no chart here on a chart and
 * never ask again. Its caller wraps it and asks again.
 */
async function addressInFront(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return recordKey(tab?.url);
}

/** What the popup says about the key a chart was read in. */
function reading(found: Detection): string {
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

  // What the page says it did, and not what this popup's own reading of the
  // settings says it should have done. The chart is read whether or not the
  // names are shown, so with them off this count is of names that are not on
  // the page — and the two reads can disagree: one of them can fail, or catch
  // a different moment. A reader looking at a chart in chord names, told that
  // six chords are named, would be right to wonder which six.
  const chords = found.applied
    ? `${found.named} chords named.`
    : `${found.named} chords would be named.`;

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
 * Whether anything at all is kept for a chart.
 *
 * Kept rather than usable, and asked of the object rather than of the value.
 * Something stored that this cannot read is a key that does nothing and
 * cannot be removed — the kind a reader would most want to be rid of — and a
 * control asking whether the value is truthy would leave them with it for
 * good, taking a place among the two hundred kept.
 *
 * Asked of the object because `in` and a bare lookup both find a
 * `constructor` on anything, and what is looked up here is a chart's name —
 * which carries an adapter's prefix today and need not tomorrow.
 */
function anythingKeptFor(settings: Settings, pageId: string): boolean {
  return Object.hasOwn(settings.keyOverrides, pageId);
}

/** The tonic on its own, which is what the control offers and keeps. */
function formatNoteOf(key: Key | null): string {
  return key ? formatNote(key.tonic) : '';
}

export default App;
