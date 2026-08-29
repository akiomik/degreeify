import { type Nesting, nesting } from './project.ts';
import { IGNORED_ENTRY } from './settings.ts';

/**
 * The reasons these scripts stop, as decisions rather than as printing.
 *
 * Each is a function of what was read and nothing else, so that what the
 * scripts refuse can be checked without a Mac, an Xcode, or a build — which
 * is what makes the checking cheap enough to happen before a change is pushed
 * rather than after somebody has read it.
 *
 * Every refusal carries what to do about it. Several of these differ only in
 * that, and one pointing at the wrong remedy has been a defect here more than
 * once: telling a reader to generate the project again, where generating it
 * again cannot help, sends them round a loop with nothing at the end of it.
 */

export interface Refusal {
  readonly lines: readonly string[];
}

const listed = (names: readonly string[]) => names.map((name) => `  ${name}`);

/**
 * Entries the converter will not carry, which is any of them beginning with a
 * dot.
 *
 * Said apart from the rest because the remedy differs: for everything else it
 * is to generate the project again, and for these there is none. A build that
 * needs one cannot be wrapped this way at all, which is the converter's limit
 * rather than a project gone out of date.
 */
export function unCarried(entries: readonly string[]): Refusal | null {
  const dotted = entries.filter((name) => name.startsWith('.') && name !== IGNORED_ENTRY);

  if (dotted.length === 0) return null;

  return {
    lines: [
      'error: the build has entries the converter cannot carry:',
      ...listed(dotted),
      'It names no dotted entry in the project, so they would be missing',
      'from the app and generating it again would not change that. This',
      'build cannot be wrapped for Safari as it stands.',
    ],
  };
}

/**
 * Icons that have changed since the project was made from them.
 *
 * A record of nothing counts as no record. It says the project was made from
 * no icons, which is not a thing that happens — so whatever left it that way,
 * the answer is the same and it is not "your icons changed".
 */
export function staleIcons(recorded: string | null, current: string): Refusal | null {
  if (recorded === null || recorded === '') {
    return {
      lines: [
        'error: what the project was made from is unknown, so whether the',
        'icons have changed cannot be told. Run `npm run safari:xcode` again',
        'and read what it says: a generation that could not record this says',
        'why, and this is what it leaves behind.',
      ],
    };
  }

  if (recorded === current) return null;

  return {
    lines: [
      'error: the icons have changed since the project was generated.',
      'The converter copies them rather than referencing them, so the app',
      'still shows the old ones. Run `npm run safari:xcode` to generate the',
      'project again.',
    ],
  };
}

/**
 * A project that no longer describes the build it wraps, either way round.
 *
 * Both directions, because both are answered by generating it again. An entry
 * the project does not name is left out of the app with nothing said, and is
 * found by wondering why a feature does nothing in Safari; an entry it names
 * and the build no longer has stops Xcode on a file it cannot copy, naming a
 * path in the build and nothing about the project being what is out of date.
 *
 * Nothing named at all is neither: it is this no longer knowing how to read a
 * project, and saying so beats reporting every entry as wrong and sending the
 * reader to regenerate something that will read the same way next time.
 */
export function projectAgainstBuild(
  named: readonly string[],
  entries: readonly string[],
  built: string,
): Refusal | null {
  if (named.length === 0) {
    return {
      lines: [
        `error: the project names no entry in ${built}, which it must.`,
        'The converter has changed how it writes them; this check needs',
        'rewriting against what it does now.',
      ],
    };
  }

  const carried = entries.filter((name) => !name.startsWith('.'));
  const missing = carried.filter((name) => !named.includes(name));

  if (missing.length > 0) {
    return {
      lines: [
        'error: the build has entries the Xcode project does not name:',
        ...listed(missing),
        'They would be left out of the app it assembles. Run',
        '`npm run safari:xcode` to generate the project again.',
      ],
    };
  }

  const gone = named.filter((name) => !entries.includes(name));

  if (gone.length > 0) {
    return {
      lines: [
        'error: the Xcode project names entries the build no longer has:',
        ...listed(gone),
        'Xcode will stop on the first of them. Run `npm run safari:xcode` to',
        'generate the project again.',
      ],
    };
  }

  return null;
}

/**
 * Identifiers the converter produced that Xcode will not embed.
 *
 * Read back rather than assumed from what was asked for: the rule they are
 * derived by is the converter's and could change under us.
 */
export function badIdentifiers(identifiers: readonly string[]): Refusal | null {
  if (identifiers.length === 0) {
    return {
      lines: [
        'error: the project names no bundle identifiers at all.',
        'The converter has changed where it writes them; this check needs',
        'rewriting against what it does now.',
      ],
    };
  }

  if (identifiers.length !== 2) {
    return {
      lines: [
        'error: expected the project to name two bundle identifiers, and it names:',
        ...listed(identifiers),
      ],
    };
  }

  return null;
}

/**
 * A project that is not the one these scripts describe.
 *
 * Two things are wrong with a pair of identifiers, and they are told apart
 * because the remedies are opposite. Identifiers that do not nest are the
 * converter's derivation gone out from under us, and no amount of generating
 * the project again will change what it derives. Identifiers that nest around
 * a name nobody here uses are a project made before the name changed, which
 * generating again is exactly the fix for.
 *
 * Read off the nesting rather than by assuming the extension's suffix. Written
 * as `expected` and `expected.Extension`, this refuses every project the
 * converter would make if it ever renamed that target — and refuses it with
 * the remedy for a stale project, which regenerates the identical project and
 * refuses it again. A refusal whose fix cannot work is worse than no refusal:
 * it costs the reader the time to try.
 */
export function foreignProject(identifiers: readonly string[], expected: string): Refusal | null {
  const nested: Nesting | null = nesting(identifiers);

  if (nested === null) {
    return {
      lines: [
        'error: the two bundle identifiers do not nest:',
        ...listed(identifiers),
        "Xcode embeds an extension only where the app's identifier is a prefix",
        'of it. The converter derives both from the app name and the bundle',
        'identifier it is given; this check needs rewriting against what it',
        'does now.',
      ],
    };
  }

  if (nested.app === expected) return null;

  return {
    lines: [
      'error: the project was generated under different names:',
      ...listed(identifiers),
      `These scripts now say ${expected}. Run \`npm run safari:xcode\` to`,
      'generate the project again, and take the old app away in Finder: what',
      'is installed under the old identifier stays installed.',
    ],
  };
}
