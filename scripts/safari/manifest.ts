import { createHash } from 'node:crypto';

/**
 * The icons an extension declares, and one line standing for all of them.
 *
 * The converter copies icons into the wrapper when it generates the project
 * rather than referencing them, so a change to one reaches the extension on a
 * rebuild and leaves the app showing what it was generated from. Which icons
 * it takes and what it makes of them is its business — describing that
 * business has been got wrong here four times — so nothing below models it.
 * The question asked is only whether the icons have changed since the project
 * was made from them, and that can be asked without knowing what was done
 * with them.
 */

export interface Icon {
  /** What the manifest called it, kept so two sources cannot collide. */
  readonly key: string;
  readonly path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every icon the manifest names, wherever it names one.
 *
 * `icons` is the set today, and an action can carry its own — as one path, or
 * as sizes of its own. Both are keyed by size, so a flat merge would have an
 * action icon stand in place of the icon of the same size rather than beside
 * it, and the displaced one would never be read: a change this cannot see, in
 * the one file it was told to watch. They are kept apart by where they came
 * from.
 */
export function iconsOf(manifest: unknown): readonly Icon[] {
  if (!isRecord(manifest)) return [];

  const icons = isRecord(manifest.icons) ? manifest.icons : {};
  const action = isRecord(manifest.action) ? manifest.action.default_icon : undefined;

  const declared: Icon[] = Object.entries(icons)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([size, path]) => ({ key: `icons:${size}`, path }));

  if (typeof action === 'string') {
    declared.push({ key: 'action', path: action });
  } else if (isRecord(action)) {
    for (const [size, path] of Object.entries(action)) {
      if (typeof path === 'string') declared.push({ key: `action:${size}`, path });
    }
  }

  return declared.sort((one, other) => (one.key < other.key ? -1 : 1));
}

/**
 * One line standing for the contents of every icon named.
 *
 * The key goes in beside the bytes, so that moving an icon from one size to
 * another is a change even where the bytes are the same ones — and each part
 * is preceded by how long it is, so that where one ends and the next begins is
 * part of what is hashed rather than something a reader of the hash has to
 * guess.
 */
export function digestOf(icons: readonly Icon[], read: (path: string) => Buffer): string {
  const digest = createHash('sha256');

  for (const { key, path } of icons) {
    const bytes = read(path);

    // How long each part is, before the part. Run together, the pieces do not
    // say where they end: `icons:48` followed by one byte hashes the same as
    // `icons:4` followed by the two bytes `8` and that one — so an icon
    // renamed to another size, with contents that differ by exactly the digit
    // that moved, comes out unchanged. That is the one thing this is for.
    digest.update(`${key.length}:${key}:${bytes.length}:`);
    digest.update(bytes);
  }

  return digest.digest('hex');
}
