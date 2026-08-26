import { chordwiki } from './chordwiki/adapter';
import type { SiteAdapter } from './types';

/**
 * Every site that can be read, in the order they are asked.
 *
 * Adding one is a matter of writing an adapter, putting it here, and letting
 * the manifest reach the site. Nothing else knows how many there are.
 */
export const ADAPTERS: readonly SiteAdapter[] = [chordwiki];

export function adapterFor(url: URL): SiteAdapter | null {
  return ADAPTERS.find((adapter) => adapter.matches(url)) ?? null;
}
