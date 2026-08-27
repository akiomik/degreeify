// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APPLIED_CLASS,
  apply,
  ORIGINAL_ATTRIBUTE,
  restore,
  STATE_ATTRIBUTE,
  WIDTH_PROPERTY,
} from '@/content/apply';
import { formatKey, type Key, type Mode } from '@/core/key';
import { parseNote } from '@/core/pitch';
import { chordwiki } from '@/sites/chordwiki/adapter';

const FIXTURES = join(import.meta.dirname, '../fixtures');

const key = (tonic: string, mode: Mode = 'major'): Key => {
  const note = parseNote(tonic);
  if (!note) throw new Error(`${tonic} is not a note`);
  return { tonic: note, mode };
};

const load = (name: string): Document =>
  parse(readFileSync(join(FIXTURES, `${name}.html`), 'utf8'));

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

/** What the page shows now, slot by slot, in document order. */
const shown = (doc: Document): string[] =>
  [...doc.querySelectorAll('p.line span.chord')].map((element) => element.textContent ?? '');

const applied = (doc: Document): Element[] => [...doc.querySelectorAll(`.${APPLIED_CLASS}`)];

/** Applies a fixture the way the content script does, and hands back the page. */
const run = (name: string, options?: Parameters<typeof apply>[2]) => {
  const doc = load(name);
  const report = apply(doc, chordwiki, options);
  return { doc, report };
};

/**
 * Every slot measures `width` until the test is over.
 *
 * This DOM lays nothing out, so every element measures nothing and the width
 * lock would never run. Stubbing the measurement is the only way to have the
 * locking and the not-locking both exercised, and which of the two happens is
 * the difference between a chart that keeps its columns and a chart whose
 * chords disappear.
 */
const measuring = (width: number) => {
  const real = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function measured(this: Element) {
    return { ...real.call(this), width } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = real;
  };
};

let stopMeasuring: (() => void) | null = null;

afterEach(() => {
  stopMeasuring?.();
  stopMeasuring = null;
});

describe('applying degree names', () => {
  it('names every chord against the key the chart states', () => {
    const { doc, report } = run('chordwiki-basic');

    expect(shown(doc)).toEqual(['I', 'VIm7', 'IVM7(#11)', 'V7-9', 'IIm7/V', 'N.C.', '', 'bIIIim']);
    expect(report.named).toBe(6);
    expect(report.passed).toBe(2);
  });

  // A chart changes key part way through, and which chords fall under which
  // key is the order they were read in. Naming a modulated section against
  // the key before it would be wrong everywhere at once.
  it('follows a chart that changes key', () => {
    const { doc, report } = run('chordwiki-modulation');

    expect(shown(doc)).toEqual([
      // Above the chart's first key line, and so in no key it has stated.
      'Gm',
      'Im',
      'IVm7',
      'bVI',
      'V7',
      'Im7',
      'IVm7',
      'bVIM7',
      'V7',
      'Im',
      'bVII',
    ]);
    expect(report.statedKeys).toBe(3);
    expect(report.unreadKeys).toBe(0);
  });

  it('reads a transposed chart in the key it is being played in', () => {
    // `Original Key: C / Play: F#`, so the chart is read in F# and not in C.
    expect(shown(run('chordwiki-transposed').doc)).toEqual(['I', 'VIm7', 'IVM7(#11)', 'V7-9']);
  });

  // A chord slot holds bar lines, accents, rhythm notes and `N.C.` as well as
  // chords, and a slot the chart left empty is still a slot. Which of them is
  // which is the whole of what this fixture is for, so the answer is written
  // out: asking only that the untouched slots are untouched would pass on a
  // page where everything was named and on one where nothing was.
  it('names the chords of a chart and leaves the rest as it found them', () => {
    const { doc, report } = run('chordwiki-tokens');

    expect(shown(doc)).toEqual([
      '|',
      '>',
      '＞',
      '(3連)',
      '(2拍3連)',
      'N.C.',
      '',
      // A chord offered rather than played keeps the brackets it was offered
      // in; a power chord and a quality with brackets of its own come through
      // with them.
      '(IIIm7)',
      'VI5/III',
      'IVM7(#11)',
    ]);
    expect(report.named).toBe(3);
    expect(report.passed).toBe(7);
  });

  it('marks the slots it named and no others', () => {
    const { doc } = run('chordwiki-tokens');

    expect(applied(doc).map((element) => element.getAttribute(ORIGINAL_ATTRIBUTE))).toEqual([
      '(Em7)',
      'A5/E',
      'FM7(#11)',
    ]);

    for (const element of doc.querySelectorAll('p.line span.chord')) {
      if (element.classList.contains(APPLIED_CLASS)) continue;
      expect(element.hasAttribute(ORIGINAL_ATTRIBUTE)).toBe(false);
      expect(element.getAttribute('style')).toBeNull();
    }
  });

  it('leaves a chart that states no key and points at none alone', () => {
    const { doc, report } = run('chordwiki-no-key');

    expect(applied(doc)).toEqual([]);
    expect(report.named).toBe(0);
    expect(report.key).toBeNull();
  });
});

describe('a key the chart states and this cannot read', () => {
  /** A chart whose second key line says something that is not a key. */
  const unreadable = () =>
    parse(`
      <div class="main">
        <p class="key">Key: C</p>
        <p class="line"><span class="chord">Am7</span></p>
        <p class="key">Key: 未定</p>
        <p class="line"><span class="chord">F</span></p>
      </div>
    `);

  // Carrying the previous key past a line that could not be read names a
  // whole section against a tonic that is not there — and a wrong degree name
  // looks exactly like a right one. Stopping leaves the section as the chart
  // wrote it, which is the failure worth having.
  it('stops naming there rather than carrying the key before it', () => {
    const doc = unreadable();
    const report = apply(doc, chordwiki);

    expect(shown(doc)).toEqual(['VIm7', 'F']);
    expect(report.unreadKeys).toBe(1);
    expect(report.statedKeys).toBe(2);
    expect(report.named).toBe(1);
    expect(report.passed).toBe(1);
  });
});

describe('a key line the chart states and this cannot read', () => {
  /** A chart whose only key line says something that is not a key. */
  const unreadableOnly = () =>
    parse(`
      <div class="main">
        <p class="key">Key: 未定</p>
        <p class="line"><span class="chord">C</span><span class="chord">Am</span></p>
        <p class="line"><span class="chord">F</span><span class="chord">G7</span></p>
        <p class="line"><span class="chord">C</span></p>
      </div>
    `);

  // The page shows a key and the extension shows no names, and the reader is
  // told to set the key by hand. If a key set by hand then did nothing, there
  // would be nothing left on the page to explain why — which is the failure
  // this whole file keeps circling.
  it('takes the key it is given where the chart states one line and it is unread', () => {
    const doc = unreadableOnly();
    const report = apply(doc, chordwiki, { key: key('G') });

    expect(shown(doc)).toEqual(['IV', 'IIm', 'bVII', 'I7', 'IV']);
    expect(report.source).toBe('manual');
    expect(report.unreadKeys).toBe(1);
  });

  it('falls back to what the chords point at where it is given nothing', () => {
    const doc = unreadableOnly();
    const report = apply(doc, chordwiki);

    expect(shown(doc)).toEqual(['I', 'VIm', 'IV', 'V7', 'I']);
    expect(report.source).toBe('inferred');
  });

  // More than one key line is a chart that changes key, and one key given for
  // the whole page cannot be right for every section of it. The section the
  // chart stopped naming stays stopped, whatever it was given.
  it('does not spread a given key over a chart that changes key', () => {
    const doc = parse(`
      <div class="main">
        <p class="key">Key: C</p>
        <p class="line"><span class="chord">Am7</span></p>
        <p class="key">Key: 未定</p>
        <p class="line"><span class="chord">F</span></p>
      </div>
    `);
    const report = apply(doc, chordwiki, { key: key('G') });

    expect(shown(doc)).toEqual(['VIm7', 'F']);
    expect(report.source).toBe('page');
  });
});

describe('the key the chart was read in', () => {
  it('is the one the chart states, said to have come from the page', () => {
    const { report } = run('chordwiki-basic');

    expect(report.source).toBe('page');
    expect(report.key && formatKey(report.key)).toBe('C');
  });

  // The first of them. A chart that changes key is in several, and what a
  // reader is looking at when they open the page is the first.
  it('is the first of several where the chart changes key', () => {
    const { report } = run('chordwiki-modulation');

    expect(report.key && formatKey(report.key)).toBe('Gm');
  });

  it('is nothing where the chart could not be read in any key', () => {
    const { report } = run('chordwiki-no-key');

    expect(report.key).toBeNull();
    expect(report.source).toBeNull();
  });
});

describe('a chart that states no key', () => {
  const stateless = (chords: readonly string[]) =>
    parse(`
      <div class="main">
        <p class="line">${chords.map((chord) => `<span class="chord">${chord}</span>`).join('')}</p>
      </div>
    `);

  it('reads it in the key its chords point at', () => {
    const doc = stateless(['C', 'Am', 'F', 'G7', 'C']);
    const report = apply(doc, chordwiki);

    expect(shown(doc)).toEqual(['I', 'VIm', 'IV', 'V7', 'I']);
    expect(report.source).toBe('inferred');
  });

  it('reads it in the key it is given instead of guessing', () => {
    const doc = stateless(['C', 'Am', 'F', 'G7', 'C']);
    const report = apply(doc, chordwiki, { key: key('G') });

    expect(shown(doc)).toEqual(['IV', 'IIm', 'bVII', 'I7', 'IV']);
    expect(report.source).toBe('manual');
  });

  // A chart that says what key it is in is the chart in front of the reader,
  // and this is not. A key given from outside stands in for the guess rather
  // than overruling the page.
  it('believes the chart over the key it is given', () => {
    const doc = load('chordwiki-basic');
    apply(doc, chordwiki, { key: key('G') });

    expect(shown(doc)[0]).toBe('I');
  });
});

describe('locking the width of a slot', () => {
  it('fixes each slot at what it measured before it was rewritten', () => {
    stopMeasuring = measuring(46.3);
    const { doc } = run('chordwiki-basic');

    const first = doc.querySelector<HTMLElement>(`.${APPLIED_CLASS}`);
    expect(first?.style.getPropertyValue(WIDTH_PROPERTY)).toBe('46.3px');
  });

  // An element that is not being rendered measures nothing, and a slot fixed
  // at nothing is a chord taken off the page. The stylesheet falls back to
  // `auto` for slots that arrive without a lock.
  it('locks nothing that measured nothing', () => {
    const { doc } = run('chordwiki-basic');

    for (const element of applied(doc)) {
      expect(element.getAttribute('style')).toBeNull();
    }
  });
});

describe('putting the page back', () => {
  it('restores every slot to the text the site served', () => {
    stopMeasuring = measuring(46.3);

    const before = load('chordwiki-basic');
    const doc = load('chordwiki-basic');
    apply(doc, chordwiki);
    restore(doc);

    expect(doc.body.innerHTML).toBe(before.body.innerHTML);
  });

  it('leaves nothing of its own behind', () => {
    stopMeasuring = measuring(46.3);

    const doc = load('chordwiki-basic');
    apply(doc, chordwiki);
    restore(doc);

    expect(applied(doc)).toEqual([]);
    expect(doc.querySelectorAll(`[${ORIGINAL_ATTRIBUTE}]`)).toHaveLength(0);
    expect(doc.documentElement.getAttribute(STATE_ATTRIBUTE)).toBe('off');
  });

  // Asked of the page rather than of a chart, so a slot the adapter would no
  // longer offer is still put back.
  it('restores a slot the chart no longer holds', () => {
    const doc = load('chordwiki-basic');
    apply(doc, chordwiki);

    const slot = doc.querySelector(`.${APPLIED_CLASS}`);
    doc.body.append(slot as Element);
    restore(doc);

    expect(slot?.textContent).toBe('C');
  });
});

describe('applying twice', () => {
  // One path into the page, whether it has been written on or not. A caller
  // changing a setting asks again and gets what a page it had never touched
  // would have given.
  it('gives what applying once gives', () => {
    stopMeasuring = measuring(46.3);

    const once = load('chordwiki-basic');
    apply(once, chordwiki);

    const twice = load('chordwiki-basic');
    apply(twice, chordwiki);
    const second = apply(twice, chordwiki);

    expect(twice.body.innerHTML).toBe(once.body.innerHTML);
    expect(second.named).toBe(6);
  });

  it('names a chart again in another key without the first naming showing through', () => {
    const doc = load('chordwiki-basic');
    apply(doc, chordwiki);
    apply(doc, chordwiki, { notation: 'roman-unicode' });

    expect(shown(doc)[1]).toBe('Ⅵm7');
  });
});

describe('the state the page is left in', () => {
  it('says so on the root element', () => {
    const { doc } = run('chordwiki-basic');
    expect(doc.documentElement.getAttribute(STATE_ATTRIBUTE)).toBe('on');

    restore(doc);
    expect(doc.documentElement.getAttribute(STATE_ATTRIBUTE)).toBe('off');
  });
});
