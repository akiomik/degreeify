import { describe, expect, it } from 'vitest';
import { type ChordSymbol, parseChord } from '@/core/chord';
import type { Accidental, Letter, Note } from '@/core/pitch';
import { ACCIDENTAL_CHARS, FLAT_CHARS, SHARP_CHARS } from '@/core/pitch';

const note = (letter: Letter, accidental: Accidental = 0): Note => ({ letter, accidental });

/** The parts of a parsed chord that a test usually cares about. */
const shapeOf = (chord: ChordSymbol) => ({
  root: chord.root,
  quality: chord.quality,
  bass: chord.bass,
  wrapper: chord.wrapper,
});

const parsed = (input: string): ChordSymbol => {
  const chord = parseChord(input);
  if (!chord) throw new Error(`expected ${input} to parse as a chord`);
  return chord;
};

describe('parseChord', () => {
  describe('roots', () => {
    const cases: [string, Note][] = [
      ['C', note('C')],
      ['C#', note('C', 1)],
      ['C♯', note('C', 1)],
      ['Db', note('D', -1)],
      ['D♭', note('D', -1)],
    ];

    it.each(cases)('reads the root of %s', (input, expected) => {
      expect(parsed(input).root).toEqual(expected);
    });
  });

  describe('qualities', () => {
    const cases: [string, string][] = [
      ['C', ''],
      ['Cm', 'm'],
      ['CM7', 'M7'],
      ['Cmaj7', 'maj7'],
      ['C7', '7'],
      ['Cm7', 'm7'],
      ['Cm7-5', 'm7-5'],
      ['CmM7', 'mM7'],
      ['Cdim', 'dim'],
      ['Cdim7', 'dim7'],
      ['Caug', 'aug'],
      ['Csus2', 'sus2'],
      ['Csus4', 'sus4'],
      ['C6', '6'],
      ['C69', '69'],
      ['Cadd9', 'add9'],
      ['C9', '9'],
      ['C11', '11'],
      ['C13', '13'],
      ['C7-9', '7-9'],
      ['C5', '5'],
    ];

    it.each(cases)('keeps the quality of %s as %j', (input, expected) => {
      expect(parsed(input).quality).toBe(expected);
    });

    it('passes an unknown quality through untouched', () => {
      expect(parsed('CwhateverThisIs').quality).toBe('whateverThisIs');
    });

    // A symbol that has more than one code point in circulation is accepted
    // in every spelling, since which one a chart carries comes down to the
    // keyboard it was typed on.
    describe('look-alikes of a symbol it already allows', () => {
      // An accidental has to be read as one wherever it appears. A spelling
      // allowed in the quality but not known to the note reader would turn a
      // token that was safely passed through into a different chord, so these
      // cases come from the note reader's own sets rather than from a copy.
      it.each([...SHARP_CHARS])('reads %j after the root as a sharp', (sharp) => {
        expect(shapeOf(parsed(`C${sharp}7`))).toEqual({
          root: note('C', 1),
          quality: '7',
          bass: null,
          wrapper: 'none',
        });
      });

      it.each([...FLAT_CHARS])('reads %j after the root as a flat', (flat) => {
        expect(shapeOf(parsed(`C${flat}7`))).toEqual({
          root: note('C', -1),
          quality: '7',
          bass: null,
          wrapper: 'none',
        });
      });

      it.each([...SHARP_CHARS])('reads %j after the bass as a sharp', (sharp) => {
        expect(parsed(`C/G${sharp}`).bass).toEqual(note('G', 1));
      });

      it.each([...FLAT_CHARS])('reads %j after the bass as a flat', (flat) => {
        expect(parsed(`C/G${flat}`).bass).toEqual(note('G', -1));
      });

      it.each([...ACCIDENTAL_CHARS])('keeps %j inside a quality', (accidental) => {
        expect(parsed(`CM7(${accidental}11)`).quality).toBe(`M7(${accidental}11)`);
      });

      // These cannot be confused with an accidental, so they only ever need
      // to survive as part of the quality.
      const inQuality: [string, string][] = [
        ['C\u03947', '\u03947'], // greek capital delta
        ['C\u25b37', '\u25b37'], // white up-pointing triangle
        ['C\u25b27', '\u25b27'], // black up-pointing triangle
        ['C\u22067', '\u22067'], // increment
        ['C\u00d87', '\u00d87'], // capital o with stroke
        ['C\u00f87', '\u00f87'], // small o with stroke
        ['C\u00b07', '\u00b07'], // degree sign
        ['Cm7\u22125', 'm7\u22125'], // minus sign
        ['Cm7\uff0d5', 'm7\uff0d5'], // full width hyphen-minus
        ['Cm7\u30fc5', 'm7\u30fc5'], // prolonged sound mark
      ];

      it.each(inQuality)('carries the quality of %j through as %j', (input, quality) => {
        expect(shapeOf(parsed(input))).toEqual({
          root: note('C'),
          quality,
          bass: null,
          wrapper: 'none',
        });
      });
    });

    it('keeps parentheses that belong to the quality', () => {
      expect(shapeOf(parsed('FM7(#11)'))).toEqual({
        root: note('F'),
        quality: 'M7(#11)',
        bass: null,
        wrapper: 'none',
      });
      expect(parsed('C7(#9)').quality).toBe('7(#9)');
    });
  });

  describe('bass notes', () => {
    it('reads a slash bass', () => {
      expect(shapeOf(parsed('C/E'))).toEqual({
        root: note('C'),
        quality: '',
        bass: note('E'),
        wrapper: 'none',
      });
    });

    it('reads an "on" bass', () => {
      expect(shapeOf(parsed('ConE'))).toEqual({
        root: note('C'),
        quality: '',
        bass: note('E'),
        wrapper: 'none',
      });
      expect(shapeOf(parsed('Dm7onG'))).toEqual({
        root: note('D'),
        quality: 'm7',
        bass: note('G'),
        wrapper: 'none',
      });
    });

    it('reads a bass after a quality', () => {
      expect(shapeOf(parsed('D#m/G#'))).toEqual({
        root: note('D', 1),
        quality: 'm',
        bass: note('G', 1),
        wrapper: 'none',
      });
      expect(shapeOf(parsed('A5/E'))).toEqual({
        root: note('A'),
        quality: '5',
        bass: note('E'),
        wrapper: 'none',
      });
    });

    it('leaves a slash that is not followed by a note in the quality', () => {
      expect(shapeOf(parsed('C7/9'))).toEqual({
        root: note('C'),
        quality: '7/9',
        bass: null,
        wrapper: 'none',
      });
    });

    it('rejects a symbol whose quality starts with a slash, since the split went wrong', () => {
      expect(parseChord('C/E/G')).toBeNull();
      expect(parseChord('C/E/9')).toBeNull();
    });

    it('does not mistake an "on" inside a quality for a bass separator', () => {
      expect(shapeOf(parsed('Con'))).toEqual({
        root: note('C'),
        quality: 'on',
        bass: null,
        wrapper: 'none',
      });
    });
  });

  describe('parentheses around the whole symbol', () => {
    it('unwraps an optional chord and records the wrapper', () => {
      expect(shapeOf(parsed('(Em7)'))).toEqual({
        root: note('E'),
        quality: 'm7',
        bass: null,
        wrapper: 'parentheses',
      });
    });

    it('keeps the original text so the wrapper can be restored', () => {
      expect(parsed('(Em7)').raw).toBe('(Em7)');
    });

    it('unwraps a symbol whose quality also has parentheses', () => {
      expect(shapeOf(parsed('(FM7(#11))'))).toEqual({
        root: note('F'),
        quality: 'M7(#11)',
        bass: null,
        wrapper: 'parentheses',
      });
    });

    it('ignores whitespace inside the parentheses', () => {
      const spaced = ['( Em7 )', '(Em7 )', '( Em7)'];
      for (const input of spaced) {
        expect(shapeOf(parsed(input))).toEqual({
          root: note('E'),
          quality: 'm7',
          bass: null,
          wrapper: 'parentheses',
        });
      }
    });

    it('rejects parentheses that do not balance, in either direction', () => {
      expect(parseChord('(Em7')).toBeNull();
      expect(parseChord('Em7)')).toBeNull();
    });

    it('does not unwrap when the opening parenthesis closes early', () => {
      expect(parseChord('(Em7)(Am7)')).toBeNull();
    });
  });

  // A quality is passed through whatever it says, but only within the
  // character set a quality is written from. Without that limit, every chart
  // direction and section label that happens to start with a note letter
  // would be relabelled as a chord.
  describe('tokens that start with a note letter but are not chords', () => {
    const notChords = [
      'D.C.', // da capo
      'D.S.', // dal segno
      'Da Capo',
      'Dal Segno',
      'Fine',
      'Coda',
      'Bridge',
      'Chorus',
      'Ending',
      'Encore',
      'Fill',
      'Bass',
      'Drums',
      'Guitar',
      'Gtr',
      'Capo',
      'Adlib',
      'Ad-lib',
      'Aメロ', // section label, as written on a Japanese chart
      'C  E', // two chords that were never split apart
    ];

    it.each(notChords)('returns null for %j', (input) => {
      expect(parseChord(input)).toBeNull();
    });

    it('still accepts a quality it has never seen', () => {
      expect(parsed('CwhateverThisIs').quality).toBe('whateverThisIs');
      expect(parsed('Gbim').quality).toBe('im');
    });
  });

  describe('accidental contract', () => {
    it('reads a flat directly after the root as part of the root', () => {
      expect(shapeOf(parsed('Ab9'))).toEqual({
        root: note('A', -1),
        quality: '9',
        bass: null,
        wrapper: 'none',
      });
    });

    it('leaves a flat elsewhere in the quality', () => {
      expect(shapeOf(parsed('C7b9'))).toEqual({
        root: note('C'),
        quality: '7b9',
        bass: null,
        wrapper: 'none',
      });
    });

    it('reads a typo the way the source site does, as a flat root plus a quality', () => {
      expect(shapeOf(parsed('Gbim'))).toEqual({
        root: note('G', -1),
        quality: 'im',
        bass: null,
        wrapper: 'none',
      });
    });
  });

  describe('surrounding whitespace', () => {
    it('is ignored, but the original text is preserved', () => {
      const chord = parsed('  Am7 ');
      expect(shapeOf(chord)).toEqual({
        root: note('A'),
        quality: 'm7',
        bass: null,
        wrapper: 'none',
      });
      expect(chord.raw).toBe('  Am7 ');
    });
  });

  // Tokens observed verbatim in chord slots on ChordWiki. Non-English strings
  // appear here as observed data only, which CONTRIBUTING.md allows.
  describe('tokens that are not chords', () => {
    const passedThrough = [
      '', // an empty chord slot
      '   ', // whitespace only
      '|', // bar line
      '>', // accent
      '＞', // accent, full width
      '(3連)', // rhythm note
      '(2拍3連)', // rhythm note
      '()', // empty parentheses
      'N.C.', // no chord
      '%', // repeat
    ];

    it.each(passedThrough)('returns null for %j', (input) => {
      expect(parseChord(input)).toBeNull();
    });
  });

  // Every distinct chord slot of one real chart, as a smoke test that nothing
  // in a whole page is dropped or mangled.
  describe('a full chart vocabulary', () => {
    const chords = [
      'A#m9',
      'Am/B',
      'B/F#',
      'Baug/A',
      'Bm9',
      'C#',
      'C#/D#',
      'C#/G#',
      'C#7-9',
      'D',
      'D#m',
      'D#m/G#',
      'F#',
      'F#aug/E',
      'Faug/D#',
      'G#dim',
      'G#m',
      'Gaug',
      'Gbim',
    ];

    it.each(chords)('parses %s', (input) => {
      expect(parseChord(input)).not.toBeNull();
    });
  });
});
