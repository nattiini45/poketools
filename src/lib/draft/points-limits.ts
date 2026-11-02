/**
 * Point limits of the legacy (pre-queue) draft engine. Dependency-free on
 * purpose: both `@/lib/draft/schemas` and the shared `@/lib/validation/schemas`
 * read these at module init, so this file must never import anything.
 */

/**
 * Upper bound of legacy draft points: a pick's `points_spent`, a pool's
 * create-time `budget` and `default_point_cost`, and a pool entry's
 * `point_cost` share it, so no accepted budget or price is out of reach of an
 * accepted bid. Live budgets are orders of magnitude below it.
 */
export const LEGACY_POINTS_MAX = 100_000;

/**
 * Rounds of a legacy pool (`draft_pools.team_size_exact` with `team_size_mode = 'exact'`): what the create body and the
 * admin form accept, and the count a pool without a stored one plays (`getDefaultRounds`).
 */
export const LEGACY_ROUNDS = { default: 11, min: 1, max: 50 } as const;