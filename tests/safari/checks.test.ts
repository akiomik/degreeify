/**
 * The builder's gates, asked of trees that were never on a disk.
 *
 * The shell version of these ran by breaking a real conversion on a Mac and
 * putting it back, which is why there were nineteen of them and not sixty, and
 * why they could not run in CI. Here the tree is an argument, so a case costs a
 * few lines and the order the gates are asked in — which decides the one
 * message a reader is shown — can be checked at all.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { refusalFor, type Tree } from '../../scripts/safari/checks.ts';
import { BUILT, BUNDLE_ID, ICONS_RECORD, PROJECT } from '../../scripts/safari/settings.ts';

const PBXPROJ = `${PROJECT}/project.pbxproj`;

/** A project naming the two identifiers the converter makes, and one entry. */
function pbxproj(
  app = BUNDLE_ID,
  extension = `${BUNDLE_ID}.Extension`,
  entries = ['manifest.json'],
) {
  return [
    `PRODUCT_BUNDLE_IDENTIFIER = ${app};`,
    `PRODUCT_BUNDLE_IDENTIFIER = "${extension}";`,
    ...entries.map((name) => `path = "../../${BUILT}/${name}";`),
  ].join('\n');
}

const ICON = Buffer.from('an icon');

function digestOf(icons: readonly [string, Buffer][]) {
  const digest = createHash('sha256');

  for (const [key, bytes] of icons) {
    digest.update(key);
    digest.update(bytes);
  }

  return digest.digest('hex');
}

const RECORDED = digestOf([['icons:48', ICON]]);

interface Parts {
  files?: Record<string, string>;
  /** Paths the tree does not have, which several gates tell from unreadable. */
  absent?: readonly string[];
  bytes?: Record<string, Buffer>;
  entries?: readonly string[];
  built?: boolean;
}

/**
 * A tree that is right in every respect the caller does not override, so that
 * each case below says only what it is about.
 */
function treeOf({ files = {}, absent = [], bytes = {}, entries, built = true }: Parts = {}): Tree {
  const contents: Record<string, string> = {
    [PBXPROJ]: pbxproj(),
    [`${BUILT}/manifest.json`]: JSON.stringify({ icons: { 48: 'icon/48.png' } }),
    [ICONS_RECORD]: RECORDED,
    ...files,
  };

  return {
    isDirectory: (path) => (path === BUILT ? built : true),
    read: (path) => (absent.includes(path) ? null : (contents[path] ?? null)),
    readBytes: (path) => {
      if (path in bytes) return bytes[path] as Buffer;
      if (path === `${BUILT}/icon/48.png`) return ICON;
      throw new Error(`no such file: ${path}`);
    },
    entries: () => entries ?? ['manifest.json'],
  };
}

const said = (tree: Tree) => refusalFor(tree)?.lines.join('\n');

describe('what the builder refuses', () => {
  it('passes a project that matches its build', () => {
    expect(refusalFor(treeOf())).toBeNull();
  });

  it('says which directory is missing when there is no build', () => {
    expect(said(treeOf({ built: false }))).toContain(`${BUILT} not found`);
  });

  it('says which file is missing when the conversion left no project', () => {
    expect(said(treeOf({ absent: [PBXPROJ] }))).toContain('project.pbxproj not found');
  });

  it('refuses a project generated under other names', () => {
    const other = 'com.example.someoneelse.Degreeify';

    expect(said(treeOf({ files: { [PBXPROJ]: pbxproj(other, `${other}.Extension`) } }))).toContain(
      'generated under different names',
    );
  });

  /**
   * The reason the check reads the nesting instead of comparing against a
   * suffix written here. Held to `expected` and `expected.Extension`, this
   * project is refused as stale — and the remedy for stale is to generate it
   * again, which makes the same project, which is refused again.
   */
  it('accepts an extension target the converter has renamed', () => {
    expect(
      refusalFor(treeOf({ files: { [PBXPROJ]: pbxproj(BUNDLE_ID, `${BUNDLE_ID}.WebExt`) } })),
    ).toBeNull();
  });

  it('refuses identifiers that do not nest, without calling the project stale', () => {
    const said_ = said(treeOf({ files: { [PBXPROJ]: pbxproj(BUNDLE_ID, 'com.example.other') } }));

    expect(said_).toContain('do not nest');
    expect(said_).not.toContain('safari:xcode');
  });

  it('says the project names no identifiers rather than that they disagree', () => {
    expect(
      said(treeOf({ files: { [PBXPROJ]: 'path = "../../.output/safari-mv3/manifest.json";' } })),
    ).toContain('no bundle identifiers at all');
  });

  it('refuses a dotted entry with no remedy', () => {
    expect(said(treeOf({ entries: ['manifest.json', '.well-known'] }))).toContain('cannot carry');
  });

  it('tolerates a .DS_Store', () => {
    expect(refusalFor(treeOf({ entries: ['manifest.json', '.DS_Store'] }))).toBeNull();
  });

  /**
   * Both are wrong with this build, and only one of them can be fixed. Asked
   * the other way round, the reader is told to generate the project again —
   * which cannot carry a dotted entry either, so they do it and are told the
   * same thing.
   */
  it('says the hopeless thing before the fixable one', () => {
    const said_ = said(treeOf({ entries: ['manifest.json', '.well-known', 'newcomer.js'] }));

    expect(said_).toContain('cannot carry');
    expect(said_).not.toContain('does not name');
  });

  it('says which file is missing when the build has no manifest', () => {
    expect(said(treeOf({ absent: [`${BUILT}/manifest.json`] }))).toContain(
      'manifest.json not found',
    );
  });

  it('refuses icons that have changed since the project was made', () => {
    expect(
      said(treeOf({ bytes: { [`${BUILT}/icon/48.png`]: Buffer.from('a different icon') } })),
    ).toContain('icons have changed');
  });

  it('does not call a record of nothing a project made from no icons', () => {
    expect(said(treeOf({ files: { [ICONS_RECORD]: '' } }))).toContain(
      'what the project was made from is unknown',
    );
  });

  it('says an icon could not be read rather than that the icons changed', () => {
    const gone = JSON.stringify({ icons: { 48: 'icon/absent.png' } });

    expect(said(treeOf({ files: { [`${BUILT}/manifest.json`]: gone } }))).toContain(
      'could not be read',
    );
  });

  it('refuses an entry the project does not name', () => {
    expect(said(treeOf({ entries: ['manifest.json', 'newcomer.js'] }))).toContain('does not name');
  });

  it('refuses an entry the build no longer has', () => {
    const names = pbxproj(BUNDLE_ID, `${BUNDLE_ID}.Extension`, ['manifest.json', 'departed.js']);

    expect(said(treeOf({ files: { [PBXPROJ]: names } }))).toContain('no longer has');
  });

  /**
   * Not an empty project: this no longer knowing how to read one. Reported as
   * entries the project failed to name, the remedy would be to generate a
   * project that reads exactly the same way next time.
   */
  it('says it cannot read the project rather than that every entry is missing', () => {
    const unreadable = `PRODUCT_BUNDLE_IDENTIFIER = ${BUNDLE_ID};\nPRODUCT_BUNDLE_IDENTIFIER = ${BUNDLE_ID}.Extension;`;

    expect(said(treeOf({ files: { [PBXPROJ]: unreadable } }))).toContain('names no entry');
  });

  /**
   * An apostrophe is not one of the project file's delimiters. Read as one,
   * the name is truncated, the project is reported as not naming an entry it
   * does name, and the remedy given is to generate a project that reads
   * exactly the same way next time.
   */
  it('reads an entry whose name holds an apostrophe', () => {
    const named = pbxproj(BUNDLE_ID, `${BUNDLE_ID}.Extension`, ['manifest.json', "don't.js"]);

    expect(
      refusalFor(treeOf({ files: { [PBXPROJ]: named }, entries: ['manifest.json', "don't.js"] })),
    ).toBeNull();
  });

  it('does not read a reference inside a directory as a top-level entry', () => {
    const inside = [
      pbxproj(BUNDLE_ID, `${BUNDLE_ID}.Extension`, ['manifest.json']),
      `path = "../../${BUILT}/chunks/some-chunk.js";`,
    ].join('\n');

    expect(refusalFor(treeOf({ files: { [PBXPROJ]: inside } }))).toBeNull();
  });
});
