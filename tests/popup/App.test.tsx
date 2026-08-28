// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { parseNote } from '@/core/pitch';
import App from '@/entrypoints/popup/App';
import { type Kept, withOverride } from '@/settings/overrides';
import {
  DEFAULT_SETTINGS,
  type Detection,
  loadSettings,
  recordKey,
  SCHEMA_VERSION,
  type Settings,
  saveKept,
} from '@/settings/storage';

/** Writes settings the way the popup does, leaving the stamps alone. */
const saveOnly = (settings: Settings) => saveKept(settings, {}, {});

const ADDRESS = 'https://ja.chordwiki.org/wiki/Test%20Song';

const note = (name: string) => {
  const parsed = parseNote(name);
  if (!parsed) throw new Error(`${name} is not a note`);
  return parsed;
};

const KEY_OF_G = { tonic: note('G'), mode: 'major' } as const;
const KEY_OF_C_MINOR = { tonic: note('C'), mode: 'minor' } as const;

const EMPTY: Kept = { settings: DEFAULT_SETTINGS, stamps: {} };

const detection = (over: Partial<Detection> = {}): Detection => ({
  version: SCHEMA_VERSION,
  pageId: 'chordwiki:chart:Test Song',
  key: { tonic: 'C', mode: 'major' },
  source: 'page',
  statedKeys: 1,
  unreadKeys: 0,
  transposeOffset: 0,
  named: 6,
  applied: true,
  updatedAt: 1,
  ...over,
});

/** Renders the popup and waits for what it reads out of storage. */
const open = async () => {
  const root = document.createElement('div');
  document.body.append(root);

  const dispose = render(() => <App />, root);

  // The popup reads storage before it can show anything, and how many turns
  // of the loop that takes is not this test's business to know. Waited for by
  // what appears rather than by a count of ticks.
  for (let tick = 0; tick < 50 && !root.querySelector('select'); tick++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { root, dispose };
};

/**
 * The tab the popup is opened over.
 *
 * Answered directly rather than through the fake browser's own tabs, so that
 * the address the popup reads is the one the test names — including the case
 * where there is no address, which is what a tab this extension has no
 * permission for reports.
 */
const onATab = async (address: string | undefined, found?: Detection) => {
  vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ url: address }] as never);

  if (found) {
    const key = recordKey(address);
    if (key) await browser.storage.local.set({ [key]: found });
  }
};

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the popup on a tab that is not a chart', () => {
  // A popup can be opened from any tab, and a tab this extension has no
  // permission for reports no address at all. That is what the popup looks
  // like most of the time, and it has to look like something: one that throws
  // here is a popup that renders nothing, with no way to reach the settings
  // that are not about a page.
  it.each([undefined, 'https://example.com/'])('says what to do, on %j', async (address) => {
    await onATab(address);
    const { root, dispose } = await open();

    expect(root.textContent).toContain('Open a ChordWiki chord chart');
    dispose();
  });

  it('still offers the settings that are not about a page', async () => {
    await onATab(undefined);
    const { root, dispose } = await open();

    expect(root.querySelectorAll('select')).toHaveLength(2);
    dispose();
  });

  // The names being shown at all is not about the page either. A reader who
  // switched them off, or who opened the popup on a chart before its content
  // script had written anything, has to be able to switch them back on —
  // which is the control they came for.
  it('still offers to turn the names off', async () => {
    await onATab(undefined);
    const { root, dispose } = await open();

    expect(root.querySelector('input[type="checkbox"]')).not.toBeNull();
    dispose();
  });
});

describe('the popup where it cannot work out which tab it is on', () => {
  // A popup is opened over whatever a reader happens to be looking at, and
  // one that throws while working out where it is renders nothing at all.
  it('shows what it can rather than nothing', async () => {
    vi.spyOn(browser.tabs, 'query').mockRejectedValue(new Error('no window'));
    const { root, dispose } = await open();

    expect(root.textContent).toContain('Open a ChordWiki chord chart');
    expect(root.querySelectorAll('select')).toHaveLength(2);
    dispose();
  });
});

describe('the popup over settings this build cannot read', () => {
  // A reader who has been on a later build and come back to this one has
  // settings this one reads as the defaults. Offering the controls would be
  // offering to write those defaults over everything they had, every key they
  // had set among it — and to report that it worked.
  // Everything about the settings is read before any of it is shown. Shown a
  // piece at a time, the popup paints its controls and takes them away a
  // moment later — and a reader who clicked inside that moment is told their
  // change could not be saved rather than told why it was never going to be.
  it('never shows the controls, not even for a moment', async () => {
    await browser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, version: SCHEMA_VERSION + 1 },
    });
    await onATab(ADDRESS, detection());

    const root = document.createElement('div');
    document.body.append(root);
    const dispose = render(() => <App />, root);

    const seen: number[] = [];
    for (let tick = 0; tick < 50; tick++) {
      seen.push(root.querySelectorAll('select').length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(seen.filter((count) => count > 0)).toEqual([]);
    expect(root.textContent).toContain('written by a newer version');
    dispose();
  });

  it('says so instead of offering to change them', async () => {
    await browser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, version: SCHEMA_VERSION + 1 },
    });
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();

    expect(root.textContent).toContain('written by a newer version');
    expect(root.querySelectorAll('select')).toHaveLength(0);
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();
    dispose();
  });

  // What is known about the page writes nothing, so nothing is at risk in
  // showing it. Taken away with the controls, a reader is left a sentence
  // about a version number and no idea whether their chart was named.
  it('still says what the chart was read as', async () => {
    await browser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, version: SCHEMA_VERSION + 1 },
    });
    await onATab(ADDRESS, detection({ statedKeys: 2, unreadKeys: 1, source: 'page' }));

    const { root, dispose } = await open();

    expect(root.textContent).toContain('C — from the chart');
    expect(root.textContent).toContain('could not be read');
    dispose();
  });

  // And the one warning, rather than that one and the general one under it
  // which says the same thing without saying which build wrote them.
  it('says which build wrote them rather than only that they could not be read', async () => {
    await browser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, version: SCHEMA_VERSION + 1 },
    });
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();

    expect(root.textContent).toContain('written by a newer version');
    expect(root.textContent).not.toContain('These are the defaults');
    dispose();
  });
});

describe('the popup on a chart', () => {
  it('says what the chart was read as', async () => {
    await onATab(ADDRESS, detection());
    const { root, dispose } = await open();

    expect(root.textContent).toContain('C — from the chart');
    expect(root.textContent).toContain('6 chords named');
    dispose();
  });

  it('offers to turn the names off', async () => {
    await onATab(ADDRESS, detection());
    const { root, dispose } = await open();

    const toggle = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(toggle?.checked).toBe(true);
    dispose();
  });

  it('shows what the setting says rather than its own idea of it', async () => {
    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });
    await onATab(ADDRESS, detection());
    const { root, dispose } = await open();

    expect(root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    dispose();
  });

  // A chart that changes key cannot be read in one key set by hand, and the
  // popup says so rather than offering a control that would not work.
  it('does not offer a key for a chart that changes key', async () => {
    await onATab(ADDRESS, detection({ statedKeys: 7 }));
    const { root, dispose } = await open();

    expect(root.textContent).toContain('states 7 keys');
    expect(root.querySelectorAll('select')).toHaveLength(2);
    dispose();
  });

  it('offers a key for a chart that states one', async () => {
    await onATab(ADDRESS, detection());
    const { root, dispose } = await open();

    expect(root.querySelectorAll('select')).toHaveLength(4);
    dispose();
  });

  // A key is kept as the key of the untransposed chart, so setting one needs
  // to know how far the chart has been transposed. A control that took a key
  // and saved none would leave a reader looking at a key they had chosen and
  // a page that had never heard of it.
  it('does not offer a key where the page does not say how far it has been transposed', async () => {
    await onATab(ADDRESS, detection({ transposeOffset: null }));
    const { root, dispose } = await open();

    expect(root.textContent).toContain('does not say how far the chart has been transposed');
    expect(root.querySelectorAll('select')).toHaveLength(2);
    dispose();
  });

  // The chart is read whether or not the names are shown, so with them off
  // this count is of names that are not on the page.
  it('says the names would be written rather than that they were', async () => {
    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });
    await onATab(ADDRESS, detection({ applied: false }));
    const { root, dispose } = await open();

    expect(root.textContent).toContain('6 chords would be named');
    dispose();
  });

  // The page and this popup read the settings separately, and either read can
  // fail or catch a different moment. Asked of its own read, the popup tells
  // a reader looking at a chart in chord names that six of them are named.
  it('says what the page did with the settings, not what its own read says', async () => {
    await saveOnly({ ...DEFAULT_SETTINGS, enabled: true });
    await onATab(ADDRESS, detection({ applied: false }));
    const { root, dispose } = await open();

    expect(root.textContent).toContain('6 chords would be named');
    dispose();
  });

  // And the other way round, which is the same disagreement: a popup whose
  // own read failed, over a page that named the chart before it did.
  it('says the names were written where the page says so and its own read did not', async () => {
    await saveOnly({ ...DEFAULT_SETTINGS, enabled: false });
    await onATab(ADDRESS, detection({ applied: true }));
    const { root, dispose } = await open();

    expect(root.textContent).toContain('6 chords named');
    dispose();
  });

  // The content script writes a new record every time it reads the page,
  // which is every time something here changes. Read once, the line this
  // popup exists for would go on describing the page as the reader found it.
  it('follows the record when the page is read again', async () => {
    await onATab(ADDRESS, detection({ key: null, source: null, named: 0, statedKeys: 0 }));
    const { root, dispose } = await open();

    expect(root.textContent).toContain('states no key');

    const key = recordKey(ADDRESS);
    if (!key) throw new Error('that is an address');
    await browser.storage.local.set({ [key]: detection({ source: 'manual', named: 6 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.textContent).toContain('C — set by hand');
    dispose();
  });

  // Solid knows which component a cleanup belongs to only while the call
  // stack is still inside it, and reading storage leaves it. Registered after
  // that, the cleanup belongs to nobody and the listener outlives the popup
  // that made it.
  it('stops following the record when it is taken down', async () => {
    const removing = vi.spyOn(browser.storage.onChanged, 'removeListener');
    await onATab(ADDRESS, detection());
    const { dispose } = await open();

    dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removing).toHaveBeenCalled();
  });

  // The record may be written between the read being asked for and its answer
  // arriving. Read first and watched afterwards, a reader who opened the
  // popup while a chart was still loading would be told there is no chart
  // here, and told it for as long as they left the popup open.
  it('shows a record that arrives while it is still reading', async () => {
    const real = browser.storage.local.get.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, 'get').mockImplementation((async (query: never) => {
      const value = await real(query);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return value;
    }) as never);

    await onATab(ADDRESS);
    const opening = open();

    // Late enough that the read for the record has been asked for and has not
    // answered yet, which is the window this is about: earlier and the read
    // finds it anyway, later and the watcher is all there is.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const key = recordKey(ADDRESS);
    if (!key) throw new Error('that is an address');
    await browser.storage.local.set({ [key]: detection() });

    const { root, dispose } = await opening;
    for (let tick = 0; tick < 50 && !root.textContent?.includes('—'); tick++) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    expect(root.textContent).toContain('C — from the chart');
    dispose();
  });

  // The settings gate the whole of the rest of the popup, so a read that
  // throws is a heading and nothing else — no toggle, and no way to reach a
  // setting that was never about a page.
  it('shows what it can when the settings cannot be read', async () => {
    vi.spyOn(browser.storage.local, 'get').mockRejectedValue(new Error('context invalidated'));
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();

    expect(root.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(root.querySelectorAll('select')).toHaveLength(2);
    dispose();
  });

  // A control showing a setting that was not kept tells a reader their answer
  // was taken when it was not, and the only other trace is a line in a
  // console they will never open.
  // The controls still work — a change reads again before it writes — but
  // until then what they show is this build's defaults rather than the
  // reader's answers, and a control showing something nobody chose has to say
  // so.
  it('says the controls are showing defaults when the settings could not be read', async () => {
    vi.spyOn(browser.storage.local, 'get').mockRejectedValue(new Error('context invalidated'));
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();

    expect(root.textContent).toContain('could not be read here');
    expect(root.querySelector('input[type="checkbox"]')).not.toBeNull();
    dispose();
  });

  // Left standing, the line saying the settings could not be read goes on
  // saying it about settings the reader has just replaced — and the change
  // reads as not having taken.
  it('stops saying its own read failed once a change has been written', async () => {
    const real = browser.storage.local.get.bind(browser.storage.local);
    let broken = true;
    vi.spyOn(browser.storage.local, 'get').mockImplementation((async (query: never) => {
      if (broken) throw new Error('context invalidated');
      return real(query);
    }) as never);

    await onATab(ADDRESS, detection());
    const { root, dispose } = await open();
    expect(root.textContent).toContain('could not be read here');

    broken = false;
    const toggle = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!toggle) throw new Error('there is a toggle');
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(root.textContent).not.toContain('could not be read');
    dispose();
  });

  // That read gates everything, and the controls that would put it right are
  // among what it switched off: a reader whose chart is named in a key they
  // set by hand is looking at a popup saying the key came from the chart,
  // with nothing to press. Nothing else asks again.
  it('reads the settings again where the read it opened with failed', async () => {
    await saveKept(
      withOverride(EMPTY, 'chordwiki:chart:Test Song', { tonic: note('Db'), mode: 'major' }, 0, 1)
        .settings,
      { 'chordwiki:chart:Test Song': 1 },
      {},
    );
    await onATab(ADDRESS, detection());

    const real = browser.storage.local.get.bind(browser.storage.local);
    let broken = true;
    const get = vi.spyOn(browser.storage.local, 'get').mockImplementation((async (query: never) => {
      if (broken && query === 'settings') throw new Error('context invalidated');
      return real(query);
    }) as never);

    const { root, dispose } = await open();
    const [tonics] = [...root.querySelectorAll('select')];
    if (!tonics) throw new Error('there is a key control');
    expect(tonics.value).toBe('');

    broken = false;
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(tonics.value).toBe('Db');
    expect(root.textContent).not.toContain('could not be read');
    get.mockRestore();
    dispose();
  });

  // The same failure takes the record, and nothing else would ask for it
  // again: the watcher fires when a record changes, and a page that has
  // written one has no reason to write it again. Left out of the asking, the
  // popup goes on saying to open a chord chart on the chord chart in front of
  // the reader — and once the settings arrive it says it while looking
  // otherwise well.
  it('reads the record again where the read it opened with failed', async () => {
    await onATab(ADDRESS, detection());

    const real = browser.storage.local.get.bind(browser.storage.local);
    let broken = true;
    const get = vi.spyOn(browser.storage.local, 'get').mockImplementation((async (query: never) => {
      if (broken) throw new Error('context invalidated');
      return real(query);
    }) as never);

    const { root, dispose } = await open();
    expect(root.textContent).toContain('Open a ChordWiki chord chart');

    broken = false;
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(root.textContent).not.toContain('Open a ChordWiki chord chart');
    expect(root.textContent).toContain('C — from the chart');
    get.mockRestore();
    dispose();
  });

  // And is not asked again where there is nothing to ask about. A page that
  // is not a chart has no record and never will.
  it('does not keep asking for a record where the read said there is none', async () => {
    await onATab(ADDRESS);

    const real = browser.storage.local.get.bind(browser.storage.local);
    const get = vi
      .spyOn(browser.storage.local, 'get')
      .mockImplementation((async (query: never) => real(query)) as never);

    const { root, dispose } = await open();
    const asked = get.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(get.mock.calls).toHaveLength(asked);
    expect(root.textContent).toContain('Open a ChordWiki chord chart');
    get.mockRestore();
    dispose();
  });

  // And says nothing about the charts, because this failure says nothing
  // about them. The pages made their own reads of the same settings, and one
  // that threw here says nothing about one that did not throw there — a
  // reader told that no chart is being named, looking at one that is, would
  // be right to stop believing the rest of this.
  it('does not claim the charts are unnamed when only its own read failed', async () => {
    vi.spyOn(browser.storage.local, 'get').mockRejectedValue(new Error('context invalidated'));
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();

    expect(root.textContent).not.toContain('until you change something here');
    expect(root.textContent).toContain('What any chart is showing is unchanged');
    dispose();
  });

  // The same is said where the read worked and what came back was not
  // settings. Both leave the controls showing this build's defaults rather
  // than the reader's answers.
  it('says the controls are showing defaults when the settings were not settings', async () => {
    await browser.storage.local.set({ settings: { version: SCHEMA_VERSION, keyOverrides: 7 } });
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();

    expect(root.textContent).toContain('could not be read');

    // And here it does say what will happen to the charts, because every page
    // reads the same stored value and answers it the same way. Two true
    // things about this state disagree on the face of it: no chart is being
    // named, and the defaults say to name every one.
    expect(root.textContent).toContain('until you change something here');
    dispose();
  });

  // The same fallback the page uses for the same failure. Read as the plain
  // defaults, the checkbox says the names are on while no page is naming
  // anything — one failure answered two ways, and the one the reader can see
  // would be the wrong one.
  it('shows the names as off where the settings could not be read', async () => {
    vi.spyOn(browser.storage.local, 'get').mockRejectedValue(new Error('context invalidated'));
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();

    expect(root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    dispose();
  });

  // Nothing to clear is nothing to write. Written anyway, it tells every open
  // tab that the settings changed over a change that is not one.
  it('does not write when a chart with no key is told to read from the chart', async () => {
    await onATab(ADDRESS, detection({ statedKeys: 0, key: null, source: null }));
    const { root, dispose } = await open();

    const wrote = vi.spyOn(browser.storage.local, 'set');
    const tonics = root.querySelector('select');
    if (!tonics) throw new Error('there is a key control');

    tonics.value = '';
    tonics.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(wrote).not.toHaveBeenCalled();
    dispose();
  });

  // The last thing that could throw before the record is read. A throw leaves
  // the popup saying there is no chart here on a chart, while doing without
  // the watching costs only a line that goes stale.
  it('shows the chart even where it cannot listen for the record changing', async () => {
    vi.spyOn(browser.storage.onChanged, 'addListener').mockImplementation(() => {
      throw new Error('no listeners left');
    });
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();

    expect(root.textContent).toContain('C — from the chart');
    dispose();
  });

  // What is stored is now what this build wrote, whatever it was before. Left
  // standing, the line goes on saying the settings could not be read about
  // settings the reader has just replaced — which reads as the change not
  // having taken.
  it('stops saying the settings could not be read once they have been written', async () => {
    await browser.storage.local.set({ settings: { version: SCHEMA_VERSION, keyOverrides: 7 } });
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();
    expect(root.textContent).toContain('could not be read');

    const toggle = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
    toggle?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(root.textContent).not.toContain('could not be read');
    dispose();
  });

  // Shown as every page is acting on them. Shown as the plain defaults, the
  // checkbox would say the names are on while no chart anywhere is named —
  // and the reader's first click would turn them off again, so it would take
  // two to turn them on.
  it('shows the names as off where the settings were not settings', async () => {
    await browser.storage.local.set({ settings: { version: SCHEMA_VERSION, keyOverrides: 7 } });
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();

    expect(root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    dispose();
  });

  // And one click turns them on, because what is written starts from what was
  // read rather than from what is shown.
  it('turns the names on with one click from there', async () => {
    await browser.storage.local.set({ settings: { version: SCHEMA_VERSION, keyOverrides: 7 } });
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();
    root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect((await loadSettings()).enabled).toBe(true);
    dispose();
  });

  // The reading this build could not use is not written back as an answer. A
  // value nobody chose, sitting where a setting goes, is one the next change
  // to something else takes for the reader's own.
  it('does not write back a setting it only fell back to', async () => {
    await browser.storage.local.set({ settings: { version: SCHEMA_VERSION, keyOverrides: 7 } });
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();
    const selects = [...root.querySelectorAll('select')];
    const numerals = selects.at(-2);
    if (!numerals) throw new Error('there is a numerals control');

    numerals.value = 'roman-unicode';
    numerals.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(await loadSettings()).toMatchObject({ enabled: true, notation: 'roman-unicode' });
    dispose();
  });

  // The settings roll themselves back; the mode control is the popup's own,
  // so nothing else would. A reader told that nothing changed would otherwise
  // be looking at a mode that had — and at a key control showing no key,
  // where the tonic they had set has no name in the mode now on offer.
  it('puts the mode back when the change to it could not be saved', async () => {
    await saveKept(
      withOverride(EMPTY, 'chordwiki:chart:Test Song', { tonic: note('Db'), mode: 'major' }, 0, 1)
        .settings,
      { 'chordwiki:chart:Test Song': 1 },
      {},
    );
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();
    const [tonics, modes] = [...root.querySelectorAll('select')];
    if (!tonics || !modes) throw new Error('there is a key control');
    expect(tonics.value).toBe('Db');

    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('quota exceeded'));
    modes.value = 'minor';
    modes.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(root.textContent).toContain('could not be saved');
    expect(modes.value).toBe('major');
    expect(tonics.value).toBe('Db');
    dispose();
  });

  // Writes are serialised, so two changes made before the first has landed
  // roll back in the order they were made: the first puts back the mode from
  // before it, and the second puts back the mode between the two. The reader
  // is left looking at a mode they never settled on, with the key reading
  // "read from the chart" on a chart that still has one.
  it('puts the mode back where it is kept when two changes could not be saved', async () => {
    await saveKept(
      withOverride(EMPTY, 'chordwiki:chart:Test Song', { tonic: note('Db'), mode: 'major' }, 0, 1)
        .settings,
      { 'chordwiki:chart:Test Song': 1 },
      {},
    );
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();
    const [tonics, modes] = [...root.querySelectorAll('select')];
    if (!tonics || !modes) throw new Error('there is a key control');

    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('quota exceeded'));

    modes.value = 'minor';
    modes.dispatchEvent(new Event('change', { bubbles: true }));
    modes.value = 'major';
    modes.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(modes.value).toBe('major');
    expect(tonics.value).toBe('Db');
    dispose();
  });

  it('says so when a change could not be saved', async () => {
    await onATab(ADDRESS, detection());
    const { root, dispose } = await open();

    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('quota exceeded'));
    const toggle = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!toggle) throw new Error('there is a toggle');
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.textContent).toContain('could not be saved');
    expect(toggle.checked).toBe(true);
    dispose();
  });

  // A key already set is still set, and the control that removes it lives
  // beside the one that sets it — so a chart edited to declare a second key
  // leaves the reader with a key they cannot reach.
  it('can still forget a key set for a chart that can no longer take one', async () => {
    await saveOnly(withOverride(EMPTY, 'chordwiki:chart:Test Song', KEY_OF_G, 0, 1).settings);
    await onATab(ADDRESS, detection({ statedKeys: 7 }));

    const { root, dispose } = await open();
    const button = root.querySelector('button');
    expect(button?.textContent).toContain('Forget the key');

    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await loadSettings()).keyOverrides).toEqual({});
    dispose();
  });

  // The escape hatch exists for two cases and has to be reachable in both.
  // Asked of the key in force rather than of the key kept, it would be
  // missing from the one where no key is in force: a page that does not say
  // how far the chart has been transposed cannot use a key, and cannot let go
  // of one either.
  it('can forget a key on a page that stopped saying how far it has moved', async () => {
    await saveKept(
      withOverride(EMPTY, 'chordwiki:chart:Test Song', KEY_OF_G, 0, 1).settings,
      {
        'chordwiki:chart:Test Song': 1,
      },
      {},
    );
    await onATab(ADDRESS, detection({ statedKeys: 1, transposeOffset: null }));

    const { root, dispose } = await open();
    const button = root.querySelector('button');
    expect(button?.textContent).toContain('Forget the key');

    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await loadSettings()).keyOverrides).toEqual({});
    dispose();
  });

  // Kept rather than usable. Something stored that this cannot read is a key
  // that does nothing and cannot be removed — the kind a reader would most
  // want to be rid of — and a control asking whether the value is truthy
  // would leave them with it for good, taking a place among the ones kept.
  it('can forget a key kept as nothing at all', async () => {
    await browser.storage.local.set({
      settings: { ...DEFAULT_SETTINGS, keyOverrides: { 'chordwiki:chart:Test Song': null } },
    });
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();
    const button = root.querySelector('button');
    expect(button?.disabled).toBe(false);

    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect((await loadSettings()).keyOverrides).toEqual({});
    dispose();
  });

  // The mode a key was in stays on offer after it is cleared. Otherwise a
  // reader clearing a minor key to choose another minor tonic finds the
  // control back on major, three of the tonics gone, and the next one they
  // choose saved as a major key.
  it('goes on offering the minor tonics after a minor key is cleared', async () => {
    await saveOnly(withOverride(EMPTY, 'chordwiki:chart:Test Song', KEY_OF_C_MINOR, 0, 1).settings);
    await onATab(ADDRESS, detection({ statedKeys: 0, key: null, source: null }));

    const { root, dispose } = await open();
    const button = root.querySelector('button');
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const offered = [...(root.querySelector('select')?.options ?? [])].map((o) => o.value);
    expect(offered).toContain('F#');
    expect(offered).not.toContain('Gb');
    dispose();
  });

  // Every change reads, alters and writes, and controls are two clicks apart.
  // Two of those overlapping both read the same thing and the second writes
  // over the first — a reader who chose numerals and then spelling before the
  // first write landed would find the numerals back as they were, with
  // nothing to say so.
  it('keeps both of two changes made in quick succession', async () => {
    await onATab(ADDRESS, detection());
    const { root, dispose } = await open();

    const selects = [...root.querySelectorAll('select')];
    const numerals = selects.at(-2);
    const spelling = selects.at(-1);
    if (!numerals || !spelling) throw new Error('there are two global settings');

    numerals.value = 'roman-unicode';
    numerals.dispatchEvent(new Event('change', { bubbles: true }));
    spelling.value = 'source';
    spelling.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    const settings = await loadSettings();
    expect(settings.notation).toBe('roman-unicode');
    expect(settings.spelling).toBe('source');
    dispose();
  });

  // A mode change is a write, and a write takes a moment. Asked of the key in
  // force, the control reads one mode while the tonics beside it are the
  // other's — and a tonic picked in between is saved in the mode the reader
  // had just moved away from.
  it('saves a tonic in the mode just chosen, not the one still stored', async () => {
    await saveKept(
      withOverride(EMPTY, 'chordwiki:chart:Test Song', KEY_OF_C_MINOR, 0, 1).settings,
      { 'chordwiki:chart:Test Song': 1 },
      {},
    );
    await onATab(ADDRESS, detection({ statedKeys: 0, key: null, source: null }));

    const { root, dispose } = await open();
    const [tonics, modes] = [...root.querySelectorAll('select')];
    if (!tonics || !modes) throw new Error('there is a key control');

    modes.value = 'major';
    modes.dispatchEvent(new Event('change', { bubbles: true }));

    // Without waiting for that to land, which is the whole of the case.
    tonics.value = 'Db';
    tonics.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect((await loadSettings()).keyOverrides['chordwiki:chart:Test Song']).toEqual({
      tonic: 'Db',
      mode: 'major',
    });
    dispose();
  });

  // A mode that names no key reaches a table that has no row for it, and
  // indexing nothing throws — out of the popup's first read, where it takes
  // the whole popup with it: no key line, no control, and no way to forget
  // the key that caused it.
  it('shows a chart whose stored key cannot be read, and can forget it', async () => {
    await saveKept(
      {
        ...DEFAULT_SETTINGS,
        keyOverrides: { 'chordwiki:chart:Test Song': { tonic: 'C', mode: 'dorian' as never } },
      },
      { 'chordwiki:chart:Test Song': 1 },
      {},
    );
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();
    expect(root.textContent).toContain('C — from the chart');

    const button = root.querySelector('button');
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await loadSettings()).keyOverrides).toEqual({});
    dispose();
  });

  // A `select` cannot show a value it has no option for. The mode arrives
  // from storage after the first paint and the options are swapped for the
  // other mode's, so a value applied while the major ones were up became
  // nothing — and `F#`, `C#` and `G#` name minor keys and no major one, so a
  // reader with one of those set was told their key was read from the chart
  // while the line above said it was set by hand.
  it.each(['F#', 'C#', 'G#', 'A'])('shows a stored key of %s minor', async (tonic) => {
    const stored = { tonic: note(tonic), mode: 'minor' } as const;
    await saveKept(
      withOverride(EMPTY, 'chordwiki:chart:Test Song', stored, 0, 1).settings,
      {
        'chordwiki:chart:Test Song': 1,
      },
      {},
    );
    await onATab(ADDRESS, detection({ statedKeys: 0, key: null, source: null }));

    const { root, dispose } = await open();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const [tonics, modes] = [...root.querySelectorAll('select')];
    expect(modes?.value).toBe('minor');
    expect(tonics?.value).toBe(tonic);
    dispose();
  });

  // A chart that changes key states one line per section, and this line is
  // the only place the reader is told how much of it went unread — the
  // warning below is for a chart named in spite of a line, and this is a
  // chart that was not named at all.
  it('counts the key lines it could not read where none of them could be', async () => {
    await onATab(ADDRESS, detection({ statedKeys: 7, unreadKeys: 7, key: null, source: null }));
    const { root, dispose } = await open();

    expect(root.textContent).toContain('states 7 keys, and 7 of them could not be read');
    dispose();
  });

  // The control that offers to set a key asks the same question the key will
  // be read with. Asked a looser one, it would take a key the page then
  // refuses — a reader looking at a key they chose and a page that has never
  // heard of it.
  it.each([1.5, '3'])(
    'does not offer a key where the page says it has moved by %s',
    async (offset) => {
      await onATab(ADDRESS, detection({ statedKeys: 1, transposeOffset: offset as never }));
      const { root, dispose } = await open();

      expect(root.textContent).toContain('does not say how far the chart has been transposed');
      expect(root.querySelectorAll('select')).toHaveLength(2);
      dispose();
    },
  );

  // The reading of what is on the page runs again whenever a page writes it,
  // for reasons of its own. A reader who has just chosen a mode has not had
  // that choice written yet, so a reading in that window would put the
  // control back where they moved it from — and save the next tonic they
  // picked in the mode they had left.
  it('keeps the mode just chosen when the page writes what it found', async () => {
    await saveKept(
      withOverride(EMPTY, 'chordwiki:chart:Test Song', KEY_OF_G, 0, 1).settings,
      { 'chordwiki:chart:Test Song': 1 },
      {},
    );
    await onATab(ADDRESS, detection());

    const { root, dispose } = await open();
    const [tonics, modes] = [...root.querySelectorAll('select')];
    if (!tonics || !modes) throw new Error('there is a key control');

    // The reader's choice takes a moment to be written, which is the window
    // this is about.
    const real = browser.storage.local.set.bind(browser.storage.local);
    vi.spyOn(browser.storage.local, 'set').mockImplementation((async (items: never) => {
      if (Object.hasOwn(items, 'settings')) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return real(items);
    }) as never);

    modes.value = 'minor';
    modes.dispatchEvent(new Event('change', { bubbles: true }));

    // The page writes what it found, inside that window.
    const key = recordKey(ADDRESS);
    if (!key) throw new Error('that is an address');
    await real({ [key]: detection({ named: 7 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(modes.value).toBe('minor');
    expect([...tonics.options].map((option) => option.value)).toContain('F#');
    dispose();
  });

  // A record is written by a content script and read by a popup, and an
  // extension is updated with pages already open. A record from another shape
  // read as though it were this one is a popup counting `undefined` chords.
  it('ignores a record written in a shape it does not know', async () => {
    await onATab(ADDRESS);
    const key = recordKey(ADDRESS);
    if (!key) throw new Error('that is an address');
    await browser.storage.local.set({
      [key]: { ...detection(), version: SCHEMA_VERSION + 1 },
    });

    const { root, dispose } = await open();

    expect(root.textContent).toContain('Open a ChordWiki chord chart');
    dispose();
  });

  // The tonics of the two modes are not the same list, so a reader wanting a
  // minor key has to be able to say so before choosing one. Otherwise the
  // only way there is through a major key they did not mean — which rewrites
  // the whole page against the wrong tonic on the way — and `C#`, `F#` and
  // `G#` are never offered at all.
  it('offers the minor tonics once minor is chosen, with no key set yet', async () => {
    await onATab(ADDRESS, detection({ statedKeys: 0, key: null, source: null }));
    const { root, dispose } = await open();

    const [tonics, modes] = [...root.querySelectorAll('select')];
    expect([...(tonics?.options ?? [])].map((option) => option.value)).toContain('Gb');
    expect(modes?.disabled).toBe(false);

    if (!modes) throw new Error('there is a mode control');
    modes.value = 'minor';
    modes.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const offered = [...(root.querySelector('select')?.options ?? [])].map((o) => o.value);
    expect(offered).toContain('F#');
    expect(offered).not.toContain('Gb');
    dispose();
  });

  // Setting a key names the chart end to end, so a line saying a section was
  // left alone is false — and sits directly under a line saying how many
  // chords were named.
  it('does not warn about an unread key line that a key set by hand answered', async () => {
    await onATab(
      ADDRESS,
      detection({
        statedKeys: 1,
        unreadKeys: 1,
        source: 'manual',
        key: { tonic: 'G', mode: 'major' },
      }),
    );
    const { root, dispose } = await open();

    expect(root.textContent).toContain('set by hand');
    expect(root.textContent).not.toContain('could not be read');
    dispose();
  });

  // The difference between "this chart states no key" and "something on this
  // page could not be read" is the difference between nothing being wrong and
  // something a person could act on.
  it('says how many key declarations it could not read', async () => {
    await onATab(ADDRESS, detection({ statedKeys: 7, unreadKeys: 2 }));
    const { root, dispose } = await open();

    expect(root.textContent).toContain('2 of 7 key declarations could not be read');
    dispose();
  });

  // Only where the chart's own declarations are what was followed. A key
  // guessed from the chords stands in for the one line that could not be
  // read, so the chart is named end to end and no section was left alone.
  it('does not warn where a guessed key answered for the line it could not read', async () => {
    await onATab(
      ADDRESS,
      detection({ statedKeys: 1, unreadKeys: 1, source: 'inferred', named: 4 }),
    );
    const { root, dispose } = await open();

    expect(root.textContent).toContain('guessed from the chords');
    expect(root.textContent).not.toContain('could not be read');
    dispose();
  });
});
