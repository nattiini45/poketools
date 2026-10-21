/**
 * Client-safe shapes of supplementary records in public responses (docs/format-packs.md, "Pack
 * extensions"). The provider contract is server-only (`src/lib/pack-extensions/types.ts`).
 */

/** Supplementary meetings of a pair, from the first player's side. */
export interface HeadToHeadSupplementRecord {
  wins: number;
  draws: number;
  losses: number;
}

/**
 * The `supplement` member of `GET /api/matches/head-to-head`, present only when the active pack
 * has a head-to-head provider: `ready` (record null when the pair never met there), `excluded`
 * (the records do not count for this viewer) or `failed` (logged on the server).
 */
export type HeadToHeadSupplement =
  | { state: 'ready'; record: HeadToHeadSupplementRecord | null }
  | { state: 'excluded' }
  | { state: 'failed' };
