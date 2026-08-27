import { apply } from '@/content/apply';
import '@/content/style.css';
import { adapterFor } from '@/sites/registry';

export default defineContentScript({
  matches: ['*://*.chordwiki.org/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'manifest',

  async main() {
    const adapter = adapterFor(new URL(location.href));
    if (!adapter?.isChordPage(document)) return;

    // Before anything is measured. A width read while the page is still
    // waiting for its own font is a width nobody will see, and locking slots
    // to it would create the misalignment the lock exists to prevent.
    await document.fonts.ready;

    apply(document, adapter);
  },
});
