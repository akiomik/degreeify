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
  saveKept,
  saveSettings,
} from '@/settings/storage';

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
    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });
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
    await saveSettings({ ...DEFAULT_SETTINGS, enabled: false });
    await onATab(ADDRESS, detection());
    const { root, dispose } = await open();

    expect(root.textContent).toContain('6 chords would be named');
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
    await saveSettings(withOverride(EMPTY, 'chordwiki:chart:Test Song', KEY_OF_G, 0, 1).settings);
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
    await saveKept(withOverride(EMPTY, 'chordwiki:chart:Test Song', KEY_OF_G, 0, 1).settings, {
      'chordwiki:chart:Test Song': 1,
    });
    await onATab(ADDRESS, detection({ statedKeys: 1, transposeOffset: null }));

    const { root, dispose } = await open();
    const button = root.querySelector('button');
    expect(button?.textContent).toContain('Forget the key');

    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await loadSettings()).keyOverrides).toEqual({});
    dispose();
  });

  // The mode a key was in stays on offer after it is cleared. Otherwise a
  // reader clearing a minor key to choose another minor tonic finds the
  // control back on major, three of the tonics gone, and the next one they
  // choose saved as a major key.
  it('goes on offering the minor tonics after a minor key is cleared', async () => {
    await saveSettings(
      withOverride(EMPTY, 'chordwiki:chart:Test Song', KEY_OF_C_MINOR, 0, 1).settings,
    );
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
