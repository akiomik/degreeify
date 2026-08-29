/**
 * The generator as a program, with `xcrun` a script on the path.
 *
 * The same tree as the builder's cases and for the same reason: the scripts
 * are copied into it and started from there, so nothing here touches the
 * project somebody is working in — which matters more for this one, since what
 * it does on a real machine is delete `safari/` and make it again.
 *
 * The stub stands in for `safari-web-extension-converter`, and does the two
 * things the scripts depend on it doing: it wipes the directory it is writing
 * into, and it writes a project naming identifiers derived from what it was
 * given. Both were established against the real converter; the point of the
 * stub is to be able to ask what happens when either changes.
 */
import { execSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_NAME,
  BUILT,
  BUNDLE_ID,
  ICONS_RECORD,
  PROJECT,
} from '../../scripts/safari/settings.ts';

let root: string;
let stubs: string;

const MANIFEST = { icons: { 48: 'icon/48.png' } };

interface Converter {
  /** What the project it writes names as the app, defaulting to what it was given. */
  app?: string;
  /** And as the extension. */
  extension?: string;
  /** Somewhere other than where the scripts look. */
  elsewhere?: boolean;
  status?: number;
}

function converter({ app, extension, elsewhere = false, status = 0 }: Converter = {}): void {
  const written = elsewhere ? 'safari/Somewhere.xcodeproj' : PROJECT;

  writeFileSync(
    join(stubs, 'xcrun'),
    [
      '#!/bin/sh',
      // What it was handed, which is what the real one derives its names from.
      'for arg in "$@"; do',
      '  case "$prev" in --bundle-identifier) given="$arg";; esac',
      '  prev="$arg"',
      'done',
      // `--force` deletes the whole directory, this run's record with it.
      `rm -rf safari/${APP_NAME}`,
      `mkdir -p "${written}"`,
      `cat > "${written}/project.pbxproj" <<END`,
      `\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${app ?? '$given'};`,
      `\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "${extension ?? '$given.Extension'}";`,
      `\t\t\t\tpath = "../../${BUILT}/manifest.json";`,
      'END',
      `exit ${status}`,
    ].join('\n'),
    { mode: 0o755 },
  );
}

/** The tree back as every case below expects to find it. */
function restore(): void {
  rmSync(join(root, '.output'), { recursive: true, force: true });
  rmSync(join(root, 'safari'), { recursive: true, force: true });

  mkdirSync(join(root, BUILT, 'icon'), { recursive: true });
  writeFileSync(join(root, BUILT, 'manifest.json'), JSON.stringify(MANIFEST));
  writeFileSync(join(root, BUILT, 'icon/48.png'), 'an icon');

  converter();
}

/**
 * A path holding only these commands, wherever they live on this system.
 *
 * Written out as a directory name, this depended on where the system keeps
 * things: `/bin` holds neither `uname` nor `sysctl` on macOS and both on a
 * Linux that has merged `/usr`, so the case that took a command away took
 * nothing away on the machine CI runs on, and went red there for a reason
 * that had nothing to do with the builder.
 */
function pathOf(needed: readonly string[]): string {
  const bare = join(root, `bare-${needed.join('-')}`);

  if (existsSync(bare)) return bare;

  mkdirSync(bare, { recursive: true });

  for (const name of needed) {
    symlinkSync(execSync(`command -v ${name}`).toString().trim(), join(bare, name));
  }

  return bare;
}

interface Ran {
  status: number | null;
  said: string;
  says: string;
}

function run(from = root, path = `${stubs}:${process.env.PATH}`): Promise<Ran> {
  const generator = spawn(process.execPath, [join(root, 'scripts/safari/generate.ts')], {
    cwd: from,
    env: { ...process.env, PATH: path },
  });

  let said = '';
  let says = '';

  generator.stdout.on('data', (chunk: Buffer) => {
    said += chunk.toString();
  });
  generator.stderr.on('data', (chunk: Buffer) => {
    says += chunk.toString();
  });

  return new Promise((settle) => {
    generator.on('exit', (status) => settle({ status, said, says }));
  });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'degreeify-generate-'));
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

describe('the generator as a program', () => {
  it('generates a project and says what it is called', async () => {
    restore();

    const ran = await run();

    expect(ran.status).toBe(0);
    expect(ran.said).toContain(`app:       ${BUNDLE_ID}`);
    expect(ran.said).toContain(`extension: ${BUNDLE_ID}.Extension`);
  });

  it('records what the icons were, so the builder can tell later', async () => {
    restore();

    await run();

    expect(readFileSync(join(root, ICONS_RECORD), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('says which directory is missing when there is no build', async () => {
    restore();
    rmSync(join(root, BUILT), { recursive: true, force: true });

    const ran = await run();

    expect(ran.status).toBe(1);
    expect(ran.says).toContain('not found');
    expect(ran.says).toContain('build:safari');
  });

  it('says what it could not run rather than failing silently', async () => {
    restore();

    // Everything a stub is written in, and no `xcrun`.
    const ran = await run(root, pathOf(['rm', 'mkdir', 'cat']));

    expect(ran.status).toBe(1);
    expect(ran.says).toContain('could not run xcrun');
  });

  it('says the converter put the project somewhere else', async () => {
    restore();
    converter({ elsewhere: true });

    const ran = await run();

    expect(ran.status).toBe(1);
    expect(ran.says).toContain('somewhere else');
  });

  /**
   * The remedy is what is being checked. Told to generate the project again,
   * the reader runs the command they have just run and is told the same thing;
   * this is the one place where that loop cannot be escaped, because there is
   * nothing behind this command to fix.
   */
  it('does not answer names it did not ask for by naming itself as the fix', async () => {
    restore();
    converter({
      app: 'com.example.someoneelse.Degreeify',
      extension: 'com.example.someoneelse.Degreeify.Ext',
    });

    const ran = await run();

    expect(ran.status).toBe(1);
    expect(ran.says).toContain('needs rewriting');
    expect(ran.says).not.toContain('safari:xcode');
  });

  it('leaves no record of a project it refused', async () => {
    restore();
    await run();
    expect(existsSync(join(root, ICONS_RECORD))).toBe(true);

    converter({ app: BUNDLE_ID, extension: 'com.example.unrelated' });
    const ran = await run();

    expect(ran.status).toBe(1);
    expect(existsSync(join(root, ICONS_RECORD))).toBe(false);
  });

  /**
   * Every path either script names is relative to the repository. Run from
   * somewhere else without pinning that down, this converts whatever build
   * happens to be under the current directory and writes the project beside
   * it — and the builder, which does pin it down, then checks a project this
   * did not make.
   */
  it('converts the repository it belongs to, not the directory it was run from', async () => {
    restore();
    const elsewhere = join(root, 'somewhere-else');
    mkdirSync(elsewhere, { recursive: true });

    const ran = await run(elsewhere);

    expect(ran.status).toBe(0);
    expect(existsSync(join(root, PROJECT, 'project.pbxproj'))).toBe(true);
    expect(existsSync(join(elsewhere, 'safari'))).toBe(false);
  });

  it("reports the converter's own status", async () => {
    restore();
    converter({ status: 70 });

    await expect(run()).resolves.toMatchObject({ status: 70 });
  });
});
