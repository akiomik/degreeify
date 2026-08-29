#!/usr/bin/env node
/**
 * Builds the generated Xcode project, without opening Xcode.
 *
 * Not what a reader of the extension does — that is Run in Xcode, so that
 * Safari is told about the app. This is here so that checking the generated
 * project still compiles is one command. Nothing runs it for you: the Xcode
 * build is not in CI, which is a deliberate choice about what a macOS runner
 * costs against a PoC that is verified by hand anyway.
 *
 * Unsigned, because nothing is being distributed. Signing is Xcode's business
 * when a person runs it there.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { arch } from 'node:os';
import { resolve } from 'node:path';
import { refusalFor, type Tree } from './checks.ts';
import { APP_NAME, PROJECT, SCRATCH } from './settings.ts';

process.chdir(resolve(import.meta.dirname, '../..'));

const SYM = resolve(SCRATCH, 'sym');
const APP = resolve(SYM, 'Debug', `${APP_NAME}.app`);

/**
 * Where the tool for unregistering an app has been.
 *
 * A path left in the LaunchServices database pointing at nothing is untidy
 * rather than harmful, so a machine without this is not a reason to fail.
 */
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister';

/**
 * Takes the built app away, however this ends.
 *
 * What was wanted from this is the answer, not the app: left where it is
 * built, it is a second Degreeify registered under the same identifier as the
 * one Xcode's Run installs, holding whatever it copied the last time this ran.
 * A reader who rebuilds and hits Run can then be shown the older of the two by
 * a system with no reason to prefer either, and finds their change does
 * nothing in Safari — which is the failure this whole script exists to keep
 * them out of.
 *
 * Not only on success. A build that stops after the app wrapper is assembled —
 * a Swift error in the app target, an interrupt during the minutes it takes —
 * leaves the copy behind exactly when it does the most harm, because the
 * reader is now debugging and the stale app is what Safari may show them while
 * they do it.
 *
 * The intermediates stay, so the next run is not a build from nothing.
 */
function cleanup(): void {
  // Only where there is something to unregister, and quietly. With nothing
  // there the tool says so at length on stderr, directly under the real error,
  // reading as a second failure that has nothing to do with anything.
  if (existsSync(APP) && existsSync(LSREGISTER)) {
    spawnSync(LSREGISTER, ['-u', APP], { stdio: 'ignore' });
  }

  rmSync(SYM, { recursive: true, force: true });
}

const tree: Tree = {
  isDirectory: (path) => existsSync(path) && statSync(path).isDirectory(),
  read: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
  readBytes: (path) => readFileSync(path),
  entries: (path) => readdirSync(path),
};

// Asked before anything is built, and before the traps below have a build to
// stop. A run refused here still runs `cleanup` on the way out: a reader whose
// project is stale is refused at the first gate over and over, and the app
// they are being protected from would otherwise sit there through all of it —
// which is the moment it does harm, since they are already wondering why
// Safari shows them something else.
process.on('exit', cleanup);

const refusal = refusalFor(tree);

if (refusal) {
  process.stderr.write(`${refusal.lines.join('\n')}\n`);
  process.exit(1);
}

// Its own process group, so it can be stopped as one. A build is a tree of
// processes, and signalling only the one started here leaves its children
// running with nothing waiting on them — to write into the directory removed
// below, or to put back what was removed.
//
// The architecture named rather than left to `xcodebuild`, which finds no
// active one, says so once per target, and builds every architecture it could.
// What is wanted is whether the project compiles on this machine, and this
// machine is what Xcode's Run will build for.
const build = spawn(
  'xcodebuild',
  [
    '-project',
    PROJECT,
    '-target',
    APP_NAME,
    '-configuration',
    'Debug',
    `ARCHS=${arch() === 'arm64' ? 'arm64' : 'x86_64'}`,
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=',
    `SYMROOT=${SYM}`,
    `OBJROOT=${resolve(SCRATCH, 'obj')}`,
    'build',
  ],
  { stdio: 'inherit', detached: true },
);

/**
 * Which signal asked this to stop, if one has.
 *
 * Noted rather than acted on. Ending is one decision, made in one place below,
 * because the two ways this can end were two handlers racing for the exit
 * status: whichever ran first won, and the one registered here at signal time
 * always lost to the one registered before the signal arrived. The build then
 * reported a plain failure for a run somebody interrupted.
 */
let stopping: NodeJS.Signals | null = null;

/**
 * Stops the build, and lets the handler below end things once it is gone.
 *
 * The group rather than the one process: a build is a tree of them, and
 * signalling only the one started here leaves its children running with
 * nothing waiting on them — to write into the directory `cleanup` removes, or
 * to put back what it took away.
 *
 * `build.pid` is known here because `spawn` returns having assigned it. The
 * shell version had to ask the shell for its job list instead, because
 * learning the pid was a statement after the one that started the build, and a
 * signal arriving between the two found nothing to stop.
 */
function interrupted(signal: NodeJS.Signals): void {
  stopping = signal;

  if (build.pid !== undefined && build.exitCode === null) {
    try {
      process.kill(-build.pid, signal);
    } catch {
      // Already gone, or never grouped. Either way there is nothing to stop.
    }
  }
}

process.on('SIGINT', () => interrupted('SIGINT'));
process.on('SIGTERM', () => interrupted('SIGTERM'));

// Failing to start is not a build that failed. `xcodebuild` comes with Xcode,
// and a machine without it gets an error object and no status at all — which,
// read as a status, exits 1 having printed nothing about what was not found.
build.on('error', (reason) => {
  process.stderr.write(`error: could not run xcodebuild: ${reason.message}\n`);
  process.stderr.write('It comes with Xcode; this needs it installed and selected.\n');
  process.exit(1);
});

// The one place this ends, once the build is gone and not before: the removal
// in `cleanup` would otherwise race a compiler still writing there.
build.on('exit', (status, signal) => {
  cleanup();
  process.removeListener('exit', cleanup);

  // Re-raised rather than swallowed, so that a caller reading the exit status
  // to decide whether the project still compiles is told this was interrupted
  // rather than that it failed on its own account — and so that a shell above
  // this sees an interrupted child, which is what stops a loop.
  //
  // The handlers go first, or this arrives back at the one that set it.
  if (stopping) {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.kill(process.pid, stopping);
    return;
  }

  // A build killed by a signal of its own has no status. Reported as one, it
  // would exit 0 — a build that never finished, called a project that still
  // compiles.
  process.exit(signal ? 1 : (status ?? 1));
});
