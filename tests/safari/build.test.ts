/**
 * The builder as a program: what it exits with, what it leaves behind, and
 * what an interrupt does to it.
 *
 * Run against a tree assembled here rather than against the repository's own.
 * The scripts are copied into it and started from there, so `import.meta.dirname`
 * takes them to this tree and not to the checkout — which is what lets these
 * cases break a project without breaking the one somebody is working in. The
 * shell version of this mutated the real one and restored it on the way out,
 * and a case that stopped early left the working copy as it had made it.
 *
 * `xcodebuild` is a script on the path. Nothing here needs Xcode, or a Mac, so
 * these run wherever the tests run.
 */
import { execSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { digestOf, iconsOf } from '../../scripts/safari/manifest.ts';
import {
  APP_NAME,
  BUILT,
  BUNDLE_ID,
  ICONS_RECORD,
  PROJECT,
} from '../../scripts/safari/settings.ts';

let root: string;
let stubs: string;

const APP = () => join(root, '.output/safari-xcodebuild/sym/Debug', `${APP_NAME}.app`);
const RAN = () => join(root, 'ran');
const GRANDCHILD = () => join(root, 'grandchild-outlived-us');

const MANIFEST = { icons: { 48: 'icon/48.png' } };

/**
 * An `xcodebuild` that does what the case needs and nothing else.
 *
 * It assembles the app wherever it was told to, because most of what is being
 * checked here is what happens to that app afterwards.
 */
function stub(body: string): void {
  writeFileSync(
    join(stubs, 'xcodebuild'),
    [
      '#!/bin/sh',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell, not JavaScript
      'for arg in "$@"; do case "$arg" in SYMROOT=*) sym="${arg#SYMROOT=}";; esac; done',
      `mkdir -p "$sym/Debug/${APP_NAME}.app"`,
      // What it was given, so a case can ask what the builder decided to pass
      // it. Written with a redirection rather than `touch`, which lives in
      // `/usr/bin` — and one case takes that away to see what happens when
      // the machine cannot be asked what it is.
      `printf '%s\\n' "$@" > "${RAN()}"`,
      body,
    ].join('\n'),
    { mode: 0o755 },
  );
}

function project(entries: readonly string[]): string {
  return [
    `PRODUCT_BUNDLE_IDENTIFIER = ${BUNDLE_ID};`,
    `PRODUCT_BUNDLE_IDENTIFIER = "${BUNDLE_ID}.Extension";`,
    ...entries.map((name) => `path = "../../${BUILT}/${name}";`),
  ].join('\n');
}

/** The tree back as every case below expects to find it. */
function restore(): void {
  rmSync(join(root, '.output'), { recursive: true, force: true });
  rmSync(RAN(), { force: true });
  rmSync(GRANDCHILD(), { force: true });

  mkdirSync(join(root, BUILT, 'icon'), { recursive: true });
  writeFileSync(join(root, BUILT, 'manifest.json'), JSON.stringify(MANIFEST));
  writeFileSync(join(root, BUILT, 'icon/48.png'), 'an icon');

  mkdirSync(join(root, PROJECT), { recursive: true });
  writeFileSync(join(root, PROJECT, 'project.pbxproj'), project(['manifest.json', 'icon']));
  writeFileSync(
    join(root, ICONS_RECORD),
    digestOf(iconsOf(MANIFEST), () => Buffer.from('an icon')),
  );

  stub('exit 0');
}

interface Ran {
  status: number | null;
  signal: string | null;
  says: string;
  seconds: number;
}

interface Run {
  signal?: NodeJS.Signals;
  /**
   * What the builder finds on its path, the stubs ahead of the usual by
   * default.
   *
   * Overridden by the case about a missing `xcodebuild`, which cannot get
   * there by deleting the stub: the real one is in `/usr/bin` on any Mac with
   * Xcode, and the case measured what that returned instead. It cannot get
   * there by emptying the path either — the stubs are shell scripts, and they
   * need the commands in them as much as the builder needs `xcodebuild`.
   */
  path?: string;
}

/** Starts the builder, and optionally signals it once it is under way. */
function run({ signal, path = `${stubs}:${process.env.PATH}` }: Run = {}): Promise<Ran> {
  const started = process.hrtime.bigint();

  // Started by its own interpreter rather than by name, so that emptying the
  // path above does not also take away the thing that runs this.
  const builder = spawn(process.execPath, [join(root, 'scripts/safari/build.ts')], {
    cwd: root,
    env: { ...process.env, PATH: path },
  });

  let says = '';

  builder.stderr.on('data', (chunk: Buffer) => {
    says += chunk.toString();
  });

  if (signal) {
    // Once the build is running and not before: the case is about a signal
    // that arrives while `xcodebuild` is going, and one sent earlier would be
    // answered by a program that has nothing to stop.
    const waiting = setInterval(() => {
      if (existsSync(RAN())) {
        clearInterval(waiting);
        builder.kill(signal);
      }
    }, 20);

    builder.on('exit', () => clearInterval(waiting));
  }

  return new Promise((settle) => {
    builder.on('exit', (status, killed) => {
      settle({
        status,
        signal: killed,
        says,
        seconds: Number(process.hrtime.bigint() - started) / 1e9,
      });
    });
  });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'degreeify-build-'));
  stubs = join(root, 'stubs');
  mkdirSync(stubs);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(import.meta.dirname, '../../scripts/safari'), join(root, 'scripts/safari'), {
    recursive: true,
  });
  restore();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the builder as a program', () => {
  it('builds a project that matches its build', async () => {
    restore();

    await expect(run()).resolves.toMatchObject({ status: 0 });
  });

  it("reports the build's own status", async () => {
    restore();
    stub('exit 65');

    await expect(run()).resolves.toMatchObject({ status: 65 });
  });

  it('takes the app away after a build that failed', async () => {
    restore();
    stub('exit 65');

    await run();

    expect(existsSync(APP())).toBe(false);
  });

  it('takes the app away after a build that worked', async () => {
    restore();

    await run();

    expect(existsSync(APP())).toBe(false);
  });

  /**
   * Named at all, because left to itself `xcodebuild` finds no active
   * architecture and builds every slice it could — two warnings that are the
   * only thing a good run prints.
   */
  it('builds for the architecture this machine is', async () => {
    restore();

    await run();

    expect(readFileSync(RAN(), 'utf8')).toContain(
      `ARCHS=${execSync('uname -m').toString().trim()}`,
    );
  });

  /**
   * `ARCHS` is taken literally on a command line. A value that is not an
   * architecture is not a wider build: `xcodebuild` fails every target with
   * "none of the architectures in ARCHS are valid", so the check reports a
   * project that does not compile when it compiles fine.
   */
  it('names no architecture rather than a wrong one when it cannot ask', async () => {
    restore();

    // The stub is written in what `/bin` holds, and `uname` and `sysctl` are
    // both in `/usr/bin`, so this is a machine that cannot be asked what it is.
    const ran = await run({ path: `${stubs}:/bin` });

    expect(ran.status).toBe(0);
    expect(readFileSync(RAN(), 'utf8')).not.toContain('ARCHS');
  });

  it('does not start a build it is going to refuse', async () => {
    restore();
    writeFileSync(join(root, ICONS_RECORD), 'a digest of something else');

    const ran = await run();

    expect(ran.status).toBe(1);
    expect(ran.says).toContain('icons have changed');
    expect(existsSync(RAN())).toBe(false);
  });

  /**
   * A stale project is refused at the first gate, over and over, and the app
   * left by the last build that got through would otherwise sit there through
   * all of it — which is exactly when it does harm, since the reader is
   * already wondering why Safari shows them something else.
   */
  it('takes an app left by an earlier run away even when it refuses', async () => {
    restore();
    mkdirSync(APP(), { recursive: true });
    writeFileSync(join(root, ICONS_RECORD), 'a digest of something else');

    await run();

    expect(existsSync(APP())).toBe(false);
  });

  it('says what it could not run rather than failing silently', async () => {
    restore();

    // Everything a stub is written in, and no `xcodebuild`: it ships in
    // `/usr/bin`, and this is the other one.
    const ran = await run({ path: '/bin' });

    expect(ran.status).toBe(1);
    expect(ran.says).toContain('could not run xcodebuild');
  });

  /**
   * Answered while the build is still going, which is the whole of it. The
   * shell version returned 143 too, and did it 28 seconds later — once the
   * build it was supposed to be interrupting had finished on its own. Reading
   * the status alone, both look the same; the clock is what tells them apart.
   */
  it('answers an interrupt while the build is still running', async () => {
    restore();
    stub('sleep 30');

    const ran = await run({ signal: 'SIGTERM' });

    expect(ran.signal).toBe('SIGTERM');
    expect(ran.seconds).toBeLessThan(10);
  });

  it('takes the app away when it is interrupted', async () => {
    restore();
    stub('sleep 30');

    await run({ signal: 'SIGTERM' });

    expect(existsSync(APP())).toBe(false);
  });

  /**
   * A build is a tree of processes. Signalling only the one that was started
   * leaves the rest running — to write into the directory being removed, or to
   * put back what was just taken away.
   */
  /**
   * `xcodebuild` exiting is not the build being over, and this one leaves
   * behind something that ignores the signal for a moment and then writes into
   * the directory being removed — a linker unwinding, in the version of this
   * that happens to people. Cleaned up on the direct child's exit alone, the
   * removal runs first and the app is put back after it.
   */
  it('does not remove the build out from under what is still writing to it', async () => {
    restore();
    stub(`(trap '' TERM; sleep 1; mkdir -p "$sym/Debug/${APP_NAME}.app") &\nsleep 30`);

    await run({ signal: 'SIGTERM' });
    await new Promise((wake) => setTimeout(wake, 2000));

    expect(existsSync(APP())).toBe(false);
    // Longer than the default, which this and the case below came within two
    // seconds of on an unloaded machine: they wait out something that was
    // asked to stop, and `settled` is allowed five seconds to see it go. A
    // deadline that tight turns a loaded runner into a red build about
    // nothing.
  }, 30_000);

  it("stops the build's children too", async () => {
    restore();
    stub(`(sleep 2; touch "${GRANDCHILD()}") & sleep 30`);

    await run({ signal: 'SIGTERM' });
    await new Promise((wake) => setTimeout(wake, 3000));

    expect(existsSync(GRANDCHILD())).toBe(false);
  }, 30_000);
});
