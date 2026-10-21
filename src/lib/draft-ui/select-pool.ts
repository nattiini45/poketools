/**
 * Which draft pool the draft-room page shows (draft-frontend §3.1 step 3).
 * Pure and client-safe.
 *
 * Only queue-engine pools are ever selected: a pool from before migration
 * M2 (`engine = 'legacy'`) belongs to the legacy DraftBoard at
 * `/leagues/[id]/draft`, and its snapshot would raise POOL_ENGINE_LEGACY.
 * A `?pool=` naming a legacy pool is ignored. `legacyPools` reports the
 * season's legacy pools so the page can link to the legacy board.
 *
 * Order (queue pools only):
 *  1. a valid `?pool=<uuid>` that belongs to this season;
 *  2. the pool that is `in_progress` (a redraft wins over the initial pool);
 *  3. the redraft in its submission phase (the page shows the redraft notice);
 *  4. the initial pool;
 *  5. otherwise the newest pool;
 *  6. none: `'legacy_only'` when the season has legacy pools only, else `'none'`.
 */
import type { AdminPoolSummary } from './snapshot-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PoolSelectionReason =
  | 'requested'
  | 'in_progress'
  | 'submissions'
  | 'initial'
  | 'latest'
  | 'legacy_only'
  | 'none';

export interface PoolSelection {
  /** Always a queue-engine pool, or null. */
  pool: AdminPoolSummary | null;
  reason: PoolSelectionReason;
  /** The season's legacy-engine pools, oldest first (usually none, or one complete initial draft). */
  legacyPools: AdminPoolSummary[];
}

/**
 * The legacy DraftBoard of a season (`/leagues/[id]/draft`). `?board=legacy`
 * keeps that page from redirecting to the draft room when the season also
 * has a queue pool (legacy initial + queue redraft).
 */
export const LEGACY_BOARD_PARAM = 'board';
export function legacyBoardHref(seasonId: string): string {
  return `/leagues/${encodeURIComponent(seasonId)}/draft?${LEGACY_BOARD_PARAM}=legacy`;
}

/** A queue-engine pool. */
export function isQueuePool(pool: Pick<AdminPoolSummary, 'engine'>): boolean {
  return pool.engine === 'queue';
}

/**
 * A pre-M2 pool that never started (`engine = 'legacy'`, status `pending`):
 * an empty placeholder, not a draft. Pages treat it as "no pool yet", and
 * creating the season's initial queue pool replaces it (`draft_create_pool`).
 */
export function isLegacyPlaceholder(pool: Pick<AdminPoolSummary, 'engine' | 'status'>): boolean {
  return pool.engine === 'legacy' && pool.status === 'pending';
}

/** A legacy pool that the legacy DraftBoard shows (started or finished, not a placeholder). */
export function isLegacyBoardPool(pool: Pick<AdminPoolSummary, 'engine' | 'status'>): boolean {
  return !isQueuePool(pool) && !isLegacyPlaceholder(pool);
}

/** Accepts a search-param value as Next passes it (string, string[] or undefined). */
export function requestedPoolId(raw: string | string[] | undefined | null): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

/**
 * @param pools the season's pools in creation order (oldest first), as
 *   `getDraftPoolsBySeason` returns them.
 * @param requested the raw `?pool=` value.
 */
export function selectPool(
  allPools: readonly AdminPoolSummary[],
  requested?: string | string[] | null,
): PoolSelection {
  const legacyPools = allPools.filter(isLegacyBoardPool);
  const pools = allPools.filter(isQueuePool);
  const pick = (pool: AdminPoolSummary | null, reason: PoolSelectionReason): PoolSelection => ({
    pool,
    reason,
    legacyPools,
  });

  const wanted = requestedPoolId(requested);
  if (wanted) {
    const match = pools.find((p) => p.id.toLowerCase() === wanted);
    if (match) return pick(match, 'requested');
  }

  const newestFirst = [...pools].reverse();
  const running = newestFirst.filter((p) => p.status === 'in_progress');
  const runningPool = running.find((p) => p.kind === 'redraft') ?? running[0];
  if (runningPool) return pick(runningPool, 'in_progress');

  const collecting = newestFirst.find((p) => p.kind === 'redraft' && p.phase === 'submissions');
  if (collecting) return pick(collecting, 'submissions');

  const initial = newestFirst.find((p) => p.kind === 'initial');
  if (initial) return pick(initial, 'initial');

  const latest = newestFirst[0];
  if (latest) return pick(latest, 'latest');
  return pick(null, legacyPools.length > 0 ? 'legacy_only' : 'none');
}
