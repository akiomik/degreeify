import { run } from '@/content/run';
import '@/content/style.css';
import { adapterFor } from '@/sites/registry';

export default defineContentScript({
  matches: ['*://*.chordwiki.org/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'manifest',

  async main() {
    const url = new URL(location.href);
    const adapter = adapterFor(url);
    if (adapter) await run(document, adapter, url);
  },
});
