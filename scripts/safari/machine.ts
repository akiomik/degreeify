/**
 * Which architecture the build should be made for.
 *
 * Xcode's Run builds for the machine, and what this script is for is telling a
 * reader whether what Run will produce still compiles. Left to itself
 * `xcodebuild` finds no active architecture, says so once per target, and
 * builds every slice it could — which answers more than was asked, and the two
 * warnings were the only thing a good run ever printed.
 */

/**
 * The architecture of the machine, as opposed to of whatever is asking.
 *
 * `uname -m` answers for the process, and a process being translated is
 * exactly the case where those differ: Rosetta is inherited by everything a
 * translated process starts, so asking a child does not get past it. macOS
 * says so directly, and `sysctl.proc_translated` is the only thing here that
 * knows the difference.
 *
 * Null where neither could be asked, and the caller then names no architecture
 * at all rather than a guess. `ARCHS` is taken literally on a command line —
 * a value that is not an architecture is not a wider build, it is a build that
 * fails on every target with `none of the architectures in ARCHS are valid`,
 * which reports a project that does not compile when it compiles.
 */
export function hostArch(translated: string | null, named: string | null): string | null {
  if (translated?.trim() === '1') return 'arm64';

  const machine = named?.trim();

  return machine ? machine : null;
}
