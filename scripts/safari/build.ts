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
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { refusalFor, type Tree } from './checks.ts';
import { hostArch } from './machine.ts';
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
function cleanup(): boolean {
  // Only where there is something to unregister, and quietly. With nothing
  // there the tool says so at length on stderr, directly under the real error,
  // reading as a second failure that has nothing to do with anything.
  if (existsSync(APP) && existsSync(LSREGISTER)) {
    spawnSync(LSREGISTER, ['-u', APP], { stdio: 'ignore' });
  }

  // Retried, and reported rather than thrown. `settled` is bounded on purpose,
  // so a straggler can outlive it and still be creating files under here — and
  // a recursive removal walking a directory somebody is writing into throws.
  // Thrown from the exit path this is called on, that is an unhandled
  // rejection in place of the interrupt the reader asked for.
  //
  // Said in the exit status as well as on stderr. The app that is still there
  // is the one thing this script exists to remove, and `npm run build:safari
  // && npm run safari:xcodebuild` — which is what the README tells a reader to
  // run — would otherwise report the whole chain as having worked.
  try {
    rmSync(SYM, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (reason) {
    process.stderr.write(`warning: ${SYM} could not be removed: ${reason}\n`);
    process.stderr.write('It holds an app that Safari may prefer to the one Xcode installs.\n');

    return false;
  }

  return true;
}

// Armed before the first thing that can be interrupted, which is neither the
// build nor the gates but the two commands below that ask what machine this
// is. A signal arriving before this line finds the default disposition and
// kills the run outright, and an app left by an earlier build stays where it
// is — which is the moment it does harm, since the reader is already
// wondering why Safari shows them something else.
process.on('exit', () => {
  if (!cleanup()) process.exitCode = 1;
});

/** The build, once there is one. */
let build: ChildProcess | undefined;

/**
 * Which signal asked this to stop, if one has.
 *
 * Noted rather than acted on. Ending is one decision, made in one place below,
 * because the two ways this can end were two handlers racing for the exit
 * status: whichever ran first won, and the one registered at signal time
 * always lost to the one registered before the signal arrived. The build then
 * reported a plain failure for a run somebody interrupted.
 */
let stopping: NodeJS.Signals | null = null;

/**
 * Stops the build, and lets the handler further down end things once it is
 * gone.
 *
 * The group rather than the one process: a build is a tree of them, and
 * signalling only the one started here leaves its children running with
 * nothing waiting on them — to write into the directory `cleanup` removes, or
 * to put back what it took away.
 */
function interrupted(signal: NodeJS.Signals): void {
  // A second one is not a repeat of the first. The reader pressing Ctrl-C
  // again is telling us the polite signal did not work, and sending the same
  // thing takes the same path it did not answer.
  const insisted = stopping !== null;

  stopping = signal;

  if (build?.pid === undefined || build.exitCode !== null) return;

  const group = -build.pid;

  try {
    process.kill(group, insisted ? 'SIGKILL' : signal);
  } catch {
    return; // Already gone. There is nothing to stop.
  }

  if (insisted) return;

  // Escalated on a clock as well as on being asked twice. `xcodebuild`
  // mid-link is slow to honour a signal and may block one outright, and only a
  // person at a terminal presses Ctrl-C again: a supervisor — `timeout`, a
  // cancelled CI job, a wrapper — sends one and then kills this process after
  // its grace period. The build, in a session of its own, outlives that and
  // goes on to write the app into `SYMROOT` with nothing left to take it away.
  //
  // The same five seconds `settled` waits, for the same reason: a wait that
  // cannot end turns an interrupt into a hang.
  setTimeout(() => {
    try {
      process.kill(group, 'SIGKILL');
    } catch {
      // Gone in the meantime, which is what was being waited for.
    }
  }, 5_000).unref();
}

// Armed before the two commands below, which are the first thing here that
// can be interrupted. Without a handler registered, a signal arriving there
// finds this process on its default disposition and kills it outright — no
// `exit` listener, no cleanup — and an app left by an earlier build stays
// registered.
//
// Not because the handler could run in the meantime: everything from here to
// the build is synchronous, so a signal is queued and delivered after it has
// started, which is why nothing here checks for a build that does not exist
// yet. What being armed buys is that the signal is queued at all rather than
// ending the process where it stands.
process.on('SIGINT', () => interrupted('SIGINT'));
process.on('SIGTERM', () => interrupted('SIGTERM'));

/** What a command said, or null where it could not be asked. */
function said(command: string, args: readonly string[]): string | null {
  const ran = spawnSync(command, args, { encoding: 'utf8' });

  return ran.status === 0 ? ran.stdout : null;
}

const tree: Tree = {
  isDirectory: (path) => existsSync(path) && statSync(path).isDirectory(),
  read: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
  readBytes: (path) => readFileSync(path),
  entries: (path) => readdirSync(path),
};

const arch = hostArch(said('sysctl', ['-n', 'sysctl.proc_translated']), said('uname', ['-m']));

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
build = spawn(
  'xcodebuild',
  [
    '-project',
    PROJECT,
    '-target',
    APP_NAME,
    '-configuration',
    'Debug',
    // Omitted rather than guessed at where the machine could not be asked:
    // `ARCHS` is literal on a command line, so a value that is not an
    // architecture fails every target rather than widening anything.
    ...(arch === null ? [] : [`ARCHS=${arch}`]),
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=',
    `SYMROOT=${SYM}`,
    `OBJROOT=${resolve(SCRATCH, 'obj')}`,
    'build',
  ],
  { stdio: 'inherit', detached: true },
);

// Failing to start is not a build that failed. `xcodebuild` comes with Xcode,
// and a machine without it gets an error object and no status at all — which,
// read as a status, exits 1 having printed nothing about what was not found.
build.on('error', (reason) => {
  process.stderr.write(`error: could not run xcodebuild: ${reason.message}\n`);
  process.stderr.write('It comes with Xcode; this needs it installed and selected.\n');
  process.exit(1);
});

/**
 * Waits for what is left of the build's process group to be gone.
 *
 * `xcodebuild` exiting is not the build being over. It forks compilers and a
 * linker, they were signalled asynchronously along with it, and it commonly
 * goes first while they are still unwinding — into the directory `cleanup` is
 * about to remove. What that leaves is either the app still there, which is
 * the one thing this script exists to take away, or a removal that throws part
 * way through on a directory somebody is still writing into.
 *
 * Escalated rather than waited out. Anything still in the group after its
 * leader has gone has had its chance to stop politely, and a build that is
 * being interrupted is not one whose output is worth finishing.
 */
async function settled(pid: number): Promise<void> {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    return; // The group is already empty.
  }

  // Bounded, because a wait that cannot end turns an interrupt into a hang —
  // and the reader who pressed Ctrl-C would press it again, arriving here a
  // second time with nothing different to do. A group that outlives this is
  // left to the removal below, which is what happened every time before.
  for (let waited = 0; waited < 5_000; waited += 25) {
    try {
      process.kill(-pid, 0);
    } catch {
      return;
    }

    await new Promise((wake) => setTimeout(wake, 25));
  }
}

// The one place this ends, once the build is gone and not before.
build.on('exit', async (status, signal) => {
  if (stopping !== null && build?.pid !== undefined) await settled(build.pid);

  const swept = cleanup();

  process.removeAllListeners('exit');

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
  process.exit(!swept || signal ? 1 : (status ?? 1));
});
