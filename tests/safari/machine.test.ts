/**
 * Which architecture the build is made for, asked without a machine to ask.
 *
 * The case that matters cannot be reached by running anything here: it needs a
 * translated process, and the interpreter these tests run in is not one. What
 * the two commands say is an argument, so the case is what they say.
 */
import { describe, expect, it } from 'vitest';
import { hostArch } from '../../scripts/safari/machine.ts';

describe('the architecture to build for', () => {
  it('is what the machine says it is', () => {
    expect(hostArch('0\n', 'arm64\n')).toBe('arm64');
    expect(hostArch('0\n', 'x86_64\n')).toBe('x86_64');
  });

  /**
   * Rosetta is inherited by everything a translated process starts, so asking
   * a child what machine this is gets the same translated answer. `uname` here
   * says `x86_64` on a Mac that is arm64, and a build made for what it said
   * compiles a slice nobody will run and reports the project fine.
   */
  it('is not what a translated process is told', () => {
    expect(hostArch('1\n', 'x86_64\n')).toBe('arm64');
  });

  it('is nothing at all where neither could be asked', () => {
    expect(hostArch(null, null)).toBeNull();
    expect(hostArch(null, '')).toBeNull();
  });
});
