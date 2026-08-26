import type { Note } from './pitch';

export type Mode = 'major' | 'minor';

/**
 * The key a passage of a chart is in.
 *
 * Working out a degree name needs only the tonic; see `degree.ts` for why the
 * mode does not come into it. The mode is carried because key inference and
 * the notations that case their numerals by it both need it.
 */
export interface Key {
  readonly tonic: Note;
  readonly mode: Mode;
}
