import { describe, expect, it } from 'vitest';
import { digestOf, type Icon, iconsOf } from '../../scripts/safari/manifest.ts';
import { bundleIdentifiers, namedEntries, nesting } from '../../scripts/safari/project.ts';
import {
  badIdentifiers,
  projectAgainstBuild,
  staleIcons,
  unCarried,
} from '../../scripts/safari/refusals.ts';

/**
 * What the Safari scripts decide, asked without a Mac.
 *
 * These decisions were shell for the length of a long review, where the only
 * way to try one was to run the whole thing against a real conversion — so
 * each change was checked against the case that prompted it and nothing else,
 * and what it broke was found by the next person to read the branch. Most of
 * the cases below are named for the round that found them.
 */

const ENTRIES = ['assets', 'chunks', 'content-scripts', 'icon', 'manifest.json', 'popup.html'];

const reference = (path: string) =>
  `\t\tAB /* x */ = {isa = PBXFileReference; path = "../../../${path}"; };`;

const pbxproj = (paths: readonly string[]) => paths.map(reference).join('\n');

describe('what the converter said the identifiers are', () => {
  it('reads them off the project', () => {
    const project = [
      '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.Degreeify;',
      '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.Degreeify.Extension;',
      '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.Degreeify;',
    ].join('\n');

    expect(bundleIdentifiers(project)).toEqual([
      'com.example.Degreeify',
      'com.example.Degreeify.Extension',
    ]);
  });

  // The project file puts quotes round any identifier that needs them, and a
  // hyphen in an org name is enough to need them. Kept, every comparison is
  // against a value no identifier can equal, and a fork with a hyphenated
  // prefix could never generate a project this would accept.
  it('takes the quotes off the ones that have them', () => {
    const project = '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "com.my-org.Degreeify";';

    expect(bundleIdentifiers(project)).toEqual(['com.my-org.Degreeify']);
  });

  // Xcode embeds an extension only where the app's identifier is a prefix of
  // it, and the converter derives the app's from the prefix plus the app name
  // while taking the flag it is given as the extension's base. Give it a name
  // whose last component is not the app name and they do not nest.
  it('finds which is the app by which contains the other', () => {
    expect(nesting(['com.example.Degreeify', 'com.example.Degreeify.Extension'])).toEqual({
      app: 'com.example.Degreeify',
      extension: 'com.example.Degreeify.Extension',
    });
  });

  it('finds it whichever order they arrive in', () => {
    expect(nesting(['com.example.Degreeify.Extension', 'com.example.Degreeify'])).toEqual({
      app: 'com.example.Degreeify',
      extension: 'com.example.Degreeify.Extension',
    });
  });

  it('says nothing where they do not nest, rather than guessing', () => {
    expect(nesting(['com.example.Degreeify', 'com.example.degreeify.Extension'])).toBeNull();
  });

  it('refuses a project that names none, which is a converter that moved them', () => {
    expect(badIdentifiers([])?.lines[0]).toContain('names no bundle identifiers');
  });

  it('refuses a count it cannot make sense of', () => {
    expect(badIdentifiers(['a', 'b', 'c'])?.lines[0]).toContain('two bundle identifiers');
  });
});

describe('what the project names in the build', () => {
  it('reads the top-level entries', () => {
    const project = pbxproj(ENTRIES.map((name) => `.output/safari-mv3/${name}`));

    expect(namedEntries(project, '.output/safari-mv3')).toEqual([...ENTRIES].sort());
  });

  // A reference to something inside a directory is not the name of anything
  // at the top of the build. Recorded whole it is an entry no name can equal,
  // and the directory holding it gets reported as unnamed.
  it('passes over a reference to something inside a directory', () => {
    const project = pbxproj(['.output/safari-mv3/content-scripts/chordwiki.js']);

    expect(namedEntries(project, '.output/safari-mv3')).toEqual([]);
  });

  // The path comes from one shared place so the two scripts cannot disagree
  // about it, and a check that writes it out again defeats that. It has to
  // hold for whatever that place says, including characters a pattern would
  // otherwise read as syntax.
  it('holds for a build path containing pattern characters', () => {
    const project = pbxproj(['.out+put/safari|mv3/popup.html']);

    expect(namedEntries(project, '.out+put/safari|mv3')).toEqual(['popup.html']);
  });

  it('takes the quoted and the bare form alike', () => {
    const project = [
      '\t\tA = {isa = PBXFileReference; path = "../../../.output/safari-mv3/popup.html"; };',
      '\t\tB = {isa = PBXFileReference; path = ../../../.output/safari-mv3/icon; };',
    ].join('\n');

    expect(namedEntries(project, '.output/safari-mv3')).toEqual(['icon', 'popup.html']);
  });
});

describe('a project against the build it wraps', () => {
  const built = '.output/safari-mv3';

  it('is content where they agree', () => {
    expect(projectAgainstBuild(ENTRIES, ENTRIES, built)).toBeNull();
  });

  it('refuses an entry the project does not name', () => {
    const refusal = projectAgainstBuild(ENTRIES, [...ENTRIES, 'background.js'], built);

    expect(refusal?.lines.join('\n')).toContain('background.js');
    expect(refusal?.lines.join('\n')).toContain('does not name');
  });

  // The other way round needs the project generated again just as much: left
  // to Xcode it stops on a file it cannot copy, naming a path in the build and
  // nothing about the project being what is out of date.
  it('refuses an entry the build no longer has', () => {
    const refusal = projectAgainstBuild(ENTRIES, ENTRIES.slice(1), built);

    expect(refusal?.lines.join('\n')).toContain('assets');
    expect(refusal?.lines.join('\n')).toContain('no longer has');
  });

  // Nothing named is not an empty project; it is this no longer knowing how to
  // read one. Reported as every entry being wrong, the reader is sent to
  // regenerate a project that will read the same way next time.
  it('says it cannot read a project rather than calling every entry wrong', () => {
    const refusal = projectAgainstBuild([], ENTRIES, built);

    expect(refusal?.lines[0]).toContain('names no entry');
    expect(refusal?.lines.join('\n')).not.toContain('does not name');
  });

  // Dotted entries are the converter's limit rather than a project gone out of
  // date, so they are not this question's business.
  it('leaves dotted entries to the check that has an answer for them', () => {
    expect(projectAgainstBuild(ENTRIES, [...ENTRIES, '.well-known'], built)).toBeNull();
  });
});

describe('entries the converter will not carry', () => {
  it('refuses a dotted entry, and says there is no remedy', () => {
    const refusal = unCarried([...ENTRIES, '.well-known']);

    expect(refusal?.lines.join('\n')).toContain('.well-known');
    expect(refusal?.lines.join('\n')).toContain('cannot be wrapped');
    expect(refusal?.lines.join('\n')).not.toContain('generate the project again');
  });

  // macOS writes this into any folder somebody opens in Finder. Refused, the
  // build stops on every machine where that has happened, and a check that
  // stops a build for nothing is a check somebody deletes.
  it('tolerates a .DS_Store', () => {
    expect(unCarried([...ENTRIES, '.DS_Store'])).toBeNull();
  });
});

describe('the icons a manifest declares', () => {
  it('takes the ones under icons', () => {
    expect(iconsOf({ icons: { '16': 'icon/16.png', '48': 'icon/48.png' } })).toEqual([
      { key: 'icons:16', path: 'icon/16.png' },
      { key: 'icons:48', path: 'icon/48.png' },
    ]);
  });

  it('takes an action icon given as one path', () => {
    expect(iconsOf({ action: { default_icon: 'icon/action.png' } })).toEqual([
      { key: 'action', path: 'icon/action.png' },
    ]);
  });

  // Both sources are keyed by size, so merged flat an action icon stands in
  // place of the icon of the same size rather than beside it — and the one it
  // displaces is never read. A change to it then goes unnoticed by the check
  // written to notice exactly that.
  it('keeps an action icon beside the icon of the same size, not in place of it', () => {
    const icons = iconsOf({
      icons: { '16': 'icon/16.png' },
      action: { default_icon: { '16': 'icon/action-16.png' } },
    });

    expect(icons.map((icon) => icon.path)).toEqual(['icon/action-16.png', 'icon/16.png']);
  });

  it('has nothing to say about a manifest that declares none', () => {
    expect(iconsOf({})).toEqual([]);
    expect(iconsOf(null)).toEqual([]);
  });
});

describe('one line standing for the icons', () => {
  const read = (contents: Record<string, string>) => (path: string) =>
    Buffer.from(contents[path] ?? '');

  const icons: Icon[] = [
    { key: 'icons:16', path: 'icon/16.png' },
    { key: 'icons:128', path: 'icon/128.png' },
  ];

  it('is the same line for the same icons', () => {
    const files = { 'icon/16.png': 'small', 'icon/128.png': 'large' };

    expect(digestOf(icons, read(files))).toBe(digestOf(icons, read(files)));
  });

  // Every size, not the largest: the converter builds the app's icon set per
  // size, so a change to a small one is in the app as much as a change to a
  // big one.
  it('changes when any one of them changes', () => {
    const before = digestOf(icons, read({ 'icon/16.png': 'small', 'icon/128.png': 'large' }));
    const after = digestOf(icons, read({ 'icon/16.png': 'other', 'icon/128.png': 'large' }));

    expect(after).not.toBe(before);
  });

  // The key goes in beside the bytes, so moving an icon from one size to
  // another is a change even where the bytes are the ones that were there.
  it('changes when the same bytes move to another size', () => {
    const files = { 'a.png': 'same', 'b.png': 'same' };
    const one = digestOf([{ key: 'icons:16', path: 'a.png' }], read(files));
    const other = digestOf([{ key: 'icons:48', path: 'a.png' }], read(files));

    expect(other).not.toBe(one);
  });

  /**
   * Where one part ends and the next begins is part of what is hashed. Run
   * together, `icons:48` followed by one byte is the same sequence as
   * `icons:4` followed by two — so a rename to another size whose contents
   * differ by exactly the digit that moved comes out unchanged, which is the
   * one thing this is here to catch.
   */
  it('does not read the join between a name and its bytes as either', () => {
    const one = digestOf([{ key: 'icons:48', path: 'a.png' }], read({ 'a.png': 'X' }));
    const other = digestOf([{ key: 'icons:4', path: 'a.png' }], read({ 'a.png': '8X' }));

    expect(other).not.toBe(one);
  });
});

describe('icons against what they were', () => {
  it('is content where they match', () => {
    expect(staleIcons('abc', 'abc')).toBeNull();
  });

  it('refuses where they differ, and says to generate the project again', () => {
    expect(staleIcons('abc', 'def')?.lines.join('\n')).toContain('safari:xcode');
  });

  // A record of nothing says the project was made from no icons, which does
  // not happen. Whatever left it that way, the answer is not "your icons
  // changed" and the remedy is to look at what the generator said.
  it.each([null, ''])('says what it does not know where the record is %j', (recorded) => {
    const refusal = staleIcons(recorded, 'abc');

    expect(refusal?.lines.join('\n')).toContain('unknown');
    expect(refusal?.lines.join('\n')).not.toContain('the icons have changed since');
  });
});
