export default defineContentScript({
  matches: ['*://*.chordwiki.org/*'],
  runAt: 'document_idle',
  main() {
    // Chord-to-degree replacement is wired up in a later change.
  },
});
