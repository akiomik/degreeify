/**
 * Chord symbols as the site itself transposes them.
 *
 * The site rewrites every chord when a reader transposes a chart, so the same
 * music appears twice under two keys — and a degree name that does not come
 * out the same both times is wrong one of those times. That makes this the
 * strongest thing there is to check the naming against: real output, from a
 * transposer that had no idea anyone would compare the two.
 *
 * What is here is a vocabulary and not a chart. The pairs are the distinct
 * ones observed, sorted, with every repeat removed, so the order a song puts
 * them in cannot be recovered from them. CONTRIBUTING.md says why that
 * matters: the chart they came off carries lyrics, and none of it may be
 * copied. A list of chord symbols is not a song.
 *
 * The non-chord tokens are in the list on purpose. They are the site's own
 * text, and there is no other way to show that they come through untouched.
 */
export interface TranspositionSample {
  readonly label: string;
  /** The key the chart is written in, and the key the transposed page is in. */
  readonly from: string;
  readonly to: string;
  readonly pairs: readonly (readonly [written: string, transposed: string])[];
}

export const TRANSPOSITION_SAMPLES: readonly TranspositionSample[] = [
  {
    label: 'up six semitones',
    from: 'F#',
    to: 'C',
    pairs: [
      ['A#m9', 'Em9'],
      ['Am/B', 'D#m/F'],
      ['B/F#', 'F/C'],
      ['Baug/A', 'Faug/D#'],
      ['Bm9', 'Fm9'],
      ['C#', 'G'],
      ['C#/D#', 'G/A'],
      ['C#/G#', 'G/D'],
      ['C#7-9', 'G7-9'],
      ['D', 'G#'],
      ['D#m', 'Am'],
      ['D#m/G#', 'Am/D'],
      ['F#', 'C'],
      ['F#aug/E', 'Caug/Bb'],
      ['Faug/D#', 'Baug/A'],
      ['G#dim', 'Ddim'],
      ['G#m', 'Dm'],
      ['Gaug', 'C#aug'],
      ['Gbim', 'Cim'],
    ],
  },
  {
    label: 'down five semitones, first key of a chart that changes key',
    from: 'Gm',
    to: 'Dm',
    pairs: [
      ['(3連)', '(3連)'],
      ['(CM7)', '(GM7)'],
      ['(Cm7)', '(Gm7)'],
      ['Bb', 'F'],
      ['C7/E', 'G7/B'],
      ['Cm7', 'Gm7'],
      ['D7/F#', 'A7/C#'],
      ['Dm7', 'Am7'],
      ['Eb', 'Bb'],
      ['F', 'C'],
      ['G', 'D'],
      ['Gm', 'Dm'],
      ['N.C.', 'N.C.'],
      ['|', '|'],
      ['＞', '＞'],
    ],
  },
  {
    label: 'down five semitones, second key of the same chart',
    from: 'Em',
    to: 'Bm',
    pairs: [
      ['(2拍3連)', '(2拍3連)'],
      ['(Am7)', '(Em7)'],
      ['(Em7)', '(Bm7)'],
      ['>', '>'],
      ['A5/E', 'E5/B'],
      ['A7/C#', 'E7/G#'],
      ['Am7', 'Em7'],
      ['Bm7', 'F#m7'],
      ['C', 'G'],
      ['CM7', 'GM7'],
      ['D', 'A'],
      ['D#m7-5', 'Bbm7-5'],
      ['D5/A', 'A5/E'],
      ['D7', 'A7'],
      ['E5/B', 'B5/F#'],
      ['Em', 'Bm'],
      ['Em7', 'Bm7'],
      ['FM7(#11)', 'CM7(#11)'],
      ['G', 'D'],
      ['G5/D', 'D5/A'],
      ['N.C.', 'N.C.'],
      ['|', '|'],
    ],
  },
];
