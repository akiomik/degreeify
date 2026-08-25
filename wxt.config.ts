import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  publicDir: 'public',
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'Degreeify',
    permissions: ['storage'],
    host_permissions: ['*://*.chordwiki.org/*'],
  },
});
