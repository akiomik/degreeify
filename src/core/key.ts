import type { Note } from './pitch';

export type Mode = 'major' | 'minor';

/**
 * The key a passage of a chart is in.
 *
 * Working out a degree name needs only the tonic; see `degree.ts` for why the
 * mode does not come into it. Nothing reads the mode yet. It is carried
 * because a chart states it and throwing it away here would mean recovering
 * it later: inferring a key from a chord sequence has to choose between a
 * major key and its relative minor, and a notation that cases its numerals
 * needs to know which it is.
 */
export interface Key {
  readonly tonic: Note;
  readonly mode: Mode;
}
