import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // The popup is the only thing written in JSX, and the only thing that needs
  // this. WXT applies the same transform to a build; a test that renders the
  // popup has to be given it here, or the popup is the one part of the
  // extension nothing can run.
  plugins: [solid(), WxtVitest()],
  test: {
    // `core` is pure and runs in node. Suites that need a DOM opt in per file
    // with `// @vitest-environment happy-dom`.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
