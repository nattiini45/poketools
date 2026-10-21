/**
 * What deleting a league (`DELETE /api/seasons/[id]` -> `deleteSeason`, one `DELETE FROM seasons`) does to the
 * rows around it, as the database's foreign keys decide it. The league admin's Danger tab lists it.
 *
 * - `deleted`: every table the delete reaches through `ON DELETE CASCADE`, directly or through another cascaded
 *   table (for example `redraft_submissions` through `evolution_tracker`), grouped for the hint.
 * - `blockers`: tables whose `season_id` key has no delete action (NO ACTION / RESTRICT). While the league still
 *   has such rows the database refuses the whole delete, so they must be removed first.
 * - `unlinked`: tables whose `season_id` is `ON DELETE SET NULL`: those rows stay, without the league.
 *
 * Derived from the schema, not guessed: `season-delete.test.ts` parses every public migration under
 * `supabase/migrations/` and fails when a foreign key adds, drops or changes an entry here. The live check is
 * the recursive `pg_constraint` query on the local stack with league groups applied, plus a rolled-back delete of a
 * league with one phase that the database refuses with SQLSTATE 23503 (evidence R4-UI-season-delete-fk-cascades.txt).
 *
 * Pure and client-safe: no reads.
 */

/** The groups the hint names, in display order. */
export const SEASON_DELETE_GROUPS = ['participants', 'groups', 'rules', 'evolution', 'tokens', 'redraft'] as const;
export type SeasonDeleteGroup = (typeof SEASON_DELETE_GROUPS)[number];

export const SEASON_DELETE_BLOCKER_GROUPS = ['phases', 'draftPools', 'teams', 'storylines'] as const;
export type SeasonDeleteBlocker = (typeof SEASON_DELETE_BLOCKER_GROUPS)[number];

export const SEASON_DELETE_UNLINK_GROUPS = ['castSessions'] as const;
export type SeasonDeleteUnlink = (typeof SEASON_DELETE_UNLINK_GROUPS)[number];

/** Cascaded tables per hint group. */
export const SEASON_DELETE_CASCADES: Readonly<Record<SeasonDeleteGroup, readonly string[]>> = {
  participants: ['season_participants'],
  groups: ['season_groups', 'season_group_members'],
  rules: ['format_rules', 'evolution_tiers', 'draft_tier_limits', 'draft_pool_entries'],
  evolution: ['evolution_tracker', 'evolution_events', 'evo_progress_log'],
  tokens: ['epb_token_grants', 'epb_draft_token_purchases', 'epb_comeback_token_spends'],
  redraft: ['redraft_slots', 'redraft_submissions', 'redraft_history', 'redraft_trade_requests'],
};

/**
 * Cascaded tables the hint does not name: a baseline table the public app neither reads nor writes (spec 4.13).
 * Listed so the schema check still accounts for every cascade.
 */
export const SEASON_DELETE_UNNAMED_CASCADES: readonly string[] = ['legacy_standings'];

/** Tables that refuse the delete while they hold rows of the league. */
export const SEASON_DELETE_BLOCKERS: Readonly<Record<SeasonDeleteBlocker, readonly string[]>> = {
  phases: ['tournaments'],
  draftPools: ['draft_pools'],
  teams: ['teams'],
  storylines: ['season_storylines'],
};

/** Tables whose rows stay, with `season_id` set to NULL. */
export const SEASON_DELETE_UNLINKS: Readonly<Record<SeasonDeleteUnlink, readonly string[]>> = {
  castSessions: ['cast_sessions'],
};
