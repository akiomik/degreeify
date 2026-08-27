// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '@/entrypoints/popup/App';
import { DEFAULT_SETTINGS, type Detection, recordKey, saveSettings } from '@/settings/storage';

const ADDRESS = 'https://ja.chordwiki.org/wiki/Test%20Song';

const detection = (over: Partial<Detection> = {}): Detection => ({
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

  // The difference between "this chart states no key" and "something on this
  // page could not be read" is the difference between nothing being wrong and
  // something a person could act on.
  it('says how many key declarations it could not read', async () => {
    await onATab(ADDRESS, detection({ statedKeys: 7, unreadKeys: 2, key: null, source: null }));
    const { root, dispose } = await open();

    expect(root.textContent).toContain('2 of 7 key declarations could not be read');
    dispose();
  });
});
