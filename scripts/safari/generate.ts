#!/usr/bin/env node
/**
 * Generates (or refreshes) the Xcode project that wraps the extension for
 * Safari.
 *
 * Run `npm run build:safari` first. The generated `safari/` directory is
 * ignored by git: it can always be made again from here.
 *
 * `--copy-resources` is deliberately not passed, so the project keeps
 * referencing the built extension. Rebuilding is then enough to change what
 * the next Xcode build picks up, and the project itself is only remade for the
 * two things it copies rather than references — the icons, and the list of
 * top-level entries.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { digestOf, iconsOf } from './manifest.ts';
import { bundleIdentifiers, nesting } from './project.ts';
import { badIdentifiers, foreignProject, type Refusal } from './refusals.ts';
import { APP_NAME, BUILT, BUNDLE_ID, ICONS_RECORD, PROJECT } from './settings.ts';

function refuse(refusal: Refusal): never {
  process.stderr.write(`${refusal.lines.join('\n')}\n`);
  process.exit(1);
}

if (!existsSync(BUILT)) {
  refuse({ lines: [`error: ${BUILT} not found. Run \`npm run build:safari\` first.`] });
}

const converted = spawnSync(
  'xcrun',
  [
    'safari-web-extension-converter',
    BUILT,
    '--project-location',
    'safari',
    '--app-name',
    APP_NAME,
    '--bundle-identifier',
    BUNDLE_ID,
    '--macos-only',
    '--swift',
    '--no-open',
    '--no-prompt',
    '--force',
  ],
  { stdio: 'inherit' },
);

// Asked about before the status, which is null for a converter that never
// ran at all — no Xcode, no command line tools, `xcrun` not on the path. Read
// as a status that is only falsy, that exits 1 having printed nothing, and the
// reader is left with a script that failed silently rather than one saying
// what it could not find.
if (converted.error) {
  refuse({
    lines: [
      `error: could not run xcrun: ${converted.error.message}`,
      'The converter comes with Xcode; this needs it installed and selected.',
    ],
  });
}

if (converted.status !== 0) process.exit(converted.status ?? 1);

// Read only where there is something to read, so that a converter which puts
// the project somewhere else says so here rather than arriving as a failure to
// open a file.
if (!existsSync(`${PROJECT}/project.pbxproj`)) {
  refuse({
    lines: [
      `error: ${PROJECT}/project.pbxproj not found after conversion.`,
      'The converter has put the project somewhere else; this script needs',
      'rewriting against what it does now.',
    ],
  });
}

const project = readFileSync(`${PROJECT}/project.pbxproj`, 'utf8');
const identifiers = bundleIdentifiers(project);
const bad = badIdentifiers(identifiers);

if (bad) refuse(bad);

// The same question the builder asks of a project it did not just make. Asked
// here too, because this is where the answer is cheap: a converter that has
// changed what it derives says so now, against the run that changed it,
// rather than at the next build against a project that looks fine.
const foreign = foreignProject(identifiers, BUNDLE_ID);

if (foreign) refuse(foreign);

const nested = nesting(identifiers);

if (!nested) refuse({ lines: ['error: unreachable: the identifiers nest and they do not.'] });

// Last, after everything that can refuse this project. The conversion above
// deletes the whole directory, this record with it, so a run that is refused
// leaves none rather than one describing the run before — and the builder says
// it does not know what the project was made from, which is true and sends the
// reader back here to read why. Written earlier, a refused project would carry
// a record saying it had been checked, and the builder would pass it through
// to an Xcode failure several steps from the mistake.
let record: string;

try {
  const manifest: unknown = JSON.parse(readFileSync(`${BUILT}/manifest.json`, 'utf8'));
  record = digestOf(iconsOf(manifest), (path) => readFileSync(`${BUILT}/${path}`));
} catch (reason) {
  refuse({
    lines: [
      'error: the project was generated, but what its icons were could not be',
      `recorded, so nothing can tell later whether they have changed: ${reason}`,
    ],
  });
}

writeFileSync(ICONS_RECORD, record);

process.stdout.write(`\nGenerated ${PROJECT}\n`);
process.stdout.write(`  app:       ${nested.app}\n`);
process.stdout.write(`  extension: ${nested.extension}\n`);
