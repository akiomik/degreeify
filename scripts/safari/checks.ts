/**
 * Everything the builder asks before it builds, as one function of what it
 * read.
 *
 * The order is part of the answer. A reader gets the first refusal and nothing
 * else, so the one they are shown has to be the one worth acting on: what
 * cannot be fixed before what can, what makes the later reads meaningless
 * before the reads themselves. Written out as a sequence of `if`s in the
 * script, that order was a property of where the lines happened to sit, and
 * moving one was a change nothing could see.
 *
 * The tree is an argument rather than the filesystem, so this can be asked
 * about a build and a project that do not exist — which is what makes the
 * cases below cheap enough to run on every push, on any machine, instead of by
 * breaking a real conversion on a Mac and putting it back.
 */
import { digestOf, iconsOf } from './manifest.ts';
import { bundleIdentifiers, namedEntries } from './project.ts';
import {
  badIdentifiers,
  foreignProject,
  projectAgainstBuild,
  type Refusal,
  staleIcons,
  unCarried,
} from './refusals.ts';
import { BUILT, BUNDLE_ID, ICONS_RECORD, PROJECT } from './settings.ts';

/**
 * What the checks need of a filesystem, and no more.
 *
 * `read` returns null for something that is not there rather than throwing,
 * because "absent" is an answer several of these checks have to tell apart
 * from a reason to stop.
 */
export interface Tree {
  isDirectory(path: string): boolean;
  read(path: string): string | null;
  readBytes(path: string): Buffer;
  entries(path: string): readonly string[];
}

const PBXPROJ = `${PROJECT}/project.pbxproj`;

export function refusalFor(tree: Tree): Refusal | null {
  if (!tree.isDirectory(BUILT)) {
    return { lines: [`error: ${BUILT} not found. Run \`npm run build:safari\` first.`] };
  }

  // The file rather than the directory around it. A conversion that was
  // interrupted leaves the one without the other, and every check below then
  // reports its own subject missing — several failures, none of them the one.
  const project = tree.read(PBXPROJ);

  if (project === null) {
    return {
      lines: [
        `error: ${PBXPROJ} not found.`,
        'Run `npm run safari:xcode` to generate the project.',
      ],
    };
  }

  const identifiers = bundleIdentifiers(project);
  const foreign = badIdentifiers(identifiers) ?? foreignProject(identifiers, BUNDLE_ID);

  if (foreign) return foreign;

  // Before the entry check below, which reads dotted names as entries the
  // project failed to name: true, and the remedy it gives is to generate the
  // project again, which cannot carry them either.
  const entries = tree.entries(BUILT);
  const hopeless = unCarried(entries);

  if (hopeless) return hopeless;

  const manifest = tree.read(`${BUILT}/manifest.json`);

  if (manifest === null) {
    return {
      lines: [`error: ${BUILT}/manifest.json not found. Run \`npm run build:safari\` first.`],
    };
  }

  let current: string;

  try {
    current = digestOf(iconsOf(JSON.parse(manifest)), (path) => tree.readBytes(`${BUILT}/${path}`));
  } catch (reason) {
    return {
      lines: [
        `error: what the build's icons are could not be read, so whether they`,
        `have changed since the project was generated cannot be told: ${reason}`,
      ],
    };
  }

  const stale = staleIcons(tree.read(ICONS_RECORD), current);

  if (stale) return stale;

  return projectAgainstBuild(namedEntries(project, BUILT), entries, BUILT);
}
