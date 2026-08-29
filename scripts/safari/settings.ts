/**
 * The names and paths both Safari scripts work from.
 *
 * In one place because they have to agree: a path meaning one thing to the
 * generator and another to the builder is a builder checking a project nobody
 * generated.
 */

export const APP_NAME = 'Degreeify';

const BUNDLE_PREFIX = 'com.github.akiomik';

/**
 * The identifier handed to the converter, derived from the app name.
 *
 * It reads this as the extension's base and builds the app's own from the
 * prefix plus the app name — so unless the last component is exactly the app
 * name, the app ends up with an identifier that is not a prefix of its
 * extension's, and Xcode refuses to embed one binary in another it does not
 * contain. That failure arrives at build time, several steps after the
 * mistake, which is why {@link nesting} reads the result back.
 *
 * Not read from the environment, for all that it would make {@link nesting}
 * reachable with a value chosen on purpose. A production script taking an
 * ambient value is how a run ends up generating a project under whatever
 * identifier the caller's shell happened to be carrying, and saying it worked.
 * It is also unnecessary here, which is half of why these decisions moved: the
 * checks are functions over identifiers, so a test reaches them by passing the
 * identifiers it wants rather than by leaving a way in through the program.
 */
export const BUNDLE_ID = `${BUNDLE_PREFIX}.${APP_NAME}`;

/** Where WXT leaves the extension this wraps. */
export const BUILT = '.output/safari-mv3';

export const PROJECT = `safari/${APP_NAME}/${APP_NAME}.xcodeproj`;

/** What the icons were when the project was generated, kept beside it. */
export const ICONS_RECORD = `safari/${APP_NAME}/.icons`;

/**
 * Where the check builds.
 *
 * Neither where the generator wipes nor where the system clears out. Building
 * registers an app with LaunchServices wherever it lands, and that cannot be
 * helped from here — what can is where it points. Inside `safari/` the next
 * regeneration deletes it; under a temporary directory macOS empties it after
 * a few days; either way the registration is left aimed at nothing.
 */
export const SCRATCH = '.output/safari-xcodebuild';

/**
 * The one dotted entry that must not stop a build.
 *
 * macOS writes it into any folder somebody opens in Finder, and no extension
 * has ever needed it. Refused, it would stop the build on every machine where
 * that had happened, which is the shape of noise that gets a check deleted.
 */
export const IGNORED_ENTRY = '.DS_Store';
