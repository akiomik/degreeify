/**
 * Reading the generated Xcode project, which is the only way to find out what
 * the converter actually did.
 *
 * Everything here asks the project rather than assuming what it will say. The
 * rules it follows are the converter's, they can change under us, and a change
 * to one should arrive as a message from these scripts rather than as an Xcode
 * failure several steps from the mistake.
 */

/**
 * The bundle identifiers the project sets, each once.
 *
 * Quotes taken off, because the project file puts them round any identifier
 * that needs them and a hyphen in an org name is enough to need them. Left on,
 * every comparison is against a value no identifier can equal.
 */
export function bundleIdentifiers(pbxproj: string): readonly string[] {
  const found = new Set<string>();

  for (const [, identifier] of pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]*);/g)) {
    // A group that took part always matched something here, since neither
    // pattern in this file can succeed with an empty one. The check is the
    // type system's price for reading a match by position, and paid rather
    // than asserted away: an assertion here would hold until somebody made the
    // group optional, and then hold silently.
    if (identifier !== undefined) found.add(identifier.replaceAll('"', '').trim());
  }

  return [...found].sort();
}

export interface Nesting {
  readonly app: string;
  readonly extension: string;
}

/**
 * Which identifier belongs to the app and which to the extension.
 *
 * Read off the nesting rather than off the order they came in, because Xcode
 * embeds an extension only where the app's identifier is a prefix of it — and
 * where they do not nest at all, which is what this is here to catch, neither
 * name is worth claiming. A message that labels them by position labels them
 * wrongly exactly when somebody is relying on it.
 */
export function nesting(identifiers: readonly string[]): Nesting | null {
  if (identifiers.length !== 2) return null;

  const [first, other] = identifiers as [string, string];

  if (other.startsWith(`${first}.`)) return { app: first, extension: other };
  if (first.startsWith(`${other}.`)) return { app: other, extension: first };

  return null;
}

/**
 * The entries of the build that the project names.
 *
 * One reading, asked both ways round by the caller: two readings would be two
 * ideas of what "named" means, and the checks disagreeing about that is the
 * drift this file exists to stop.
 *
 * Read both ways the project file writes a value: quoted, where only the
 * closing quote ends it, and bare, where whitespace or a semicolon does.
 */
export function namedEntries(pbxproj: string, built: string): readonly string[] {
  const found = new Set<string>();
  const where = escaped(built);

  // Read by how the value is written rather than by a set of characters no
  // name may hold. The project file quotes any value that needs it, and inside
  // quotes only the closing quote ends it — so a `;`, a `'` or a space in a
  // name is part of the name. Taking those for terminators truncates it, the
  // entry is reported as one the project does not name when it does, and the
  // remedy offered is to generate a project that will read the same way.
  //
  // Widening the set of characters allowed was how this was answered once
  // already, for the apostrophe. The set was the wrong idea: what ends a value
  // is what opened it.
  const quoted = new RegExp(`"(?:[^"\\\\]|\\\\.)*/${where}/((?:[^"\\\\]|\\\\.)+)"`, 'g');
  const bare = new RegExp(`(?:^|[\\s=])[^\\s";]*/${where}/([^\\s";]+)`, 'gm');

  for (const wanted of [quoted, bare]) {
    for (const [, name] of pbxproj.matchAll(wanted)) {
      // No separator in what is taken: these are the names of things at the
      // top of the build, and a reference to something inside a directory is
      // not one of them. Recorded whole it would be an entry no name can
      // equal, and the directory holding it would be reported unnamed — a
      // project called stale for having said more than expected.
      if (name !== undefined && !name.includes('/')) found.add(name.replaceAll('\\"', '"'));
    }
  }

  return [...found].sort();
}

/** `text` as a pattern matching itself and nothing else. */
function escaped(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
