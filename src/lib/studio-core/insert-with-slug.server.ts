/**
 * Inserting a definition under a unique slug. Server only (it draws random hex digits for the last-resort suffix).
 *
 * An explicit slug that is taken fails as the insert fails; a generated one retries with the suffixes -2 to -9 and then
 * four random hex digits, and gives up with the last "taken" error. The studio supplies the insert and the test for its
 * own "slug taken" error.
 */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { withSlugSuffix } from './slug';

export type SlugRequest = { explicit: string } | { base: string };

/**
 * The slugs a generated insert tries, in order: the base, the base with -2 to -9, then (the last resort) the base plus four
 * random hex digits. The new-competition function tries the same list inside its transaction.
 */
export function slugCandidates(base: string): string[] {
  return [
    base,
    ...[2, 3, 4, 5, 6, 7, 8, 9].map((attempt) => withSlugSuffix(base, attempt)),
    withSlugSuffix(base, 10, randomBytes(2).toString('hex')),
  ];
}

export async function insertWithSlug<T>(
  create: (slug: string) => Promise<T>,
  isSlugTaken: (error: unknown) => boolean,
  slug: SlugRequest,
): Promise<T> {
  if ('explicit' in slug) return create(slug.explicit);
  let lastError: unknown;
  for (const candidate of slugCandidates(slug.base)) {
    try {
      return await create(candidate);
    } catch (err) {
      if (!isSlugTaken(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
