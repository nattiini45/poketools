/**
 * Literal fallbacks of the applied draft RPCs, mirrored for the app code that must agree with what
 * the database does when neither the request nor a stored row supplies the value.
 *
 * These are NOT format-pack values: an applied migration is immutable, so each constant here changes
 * only together with a new migration that changes the SQL literal. Where TS writes an explicit value
 * (the `format_rules` defaults of a new season), the format pack default is used instead
 * (docs/format-packs.md, "SQL residuals").
 */

/**
 * Picks per trainer when neither the request config nor `format_rules.draft_picks` supplies one.
 * Mirrors `COALESCE(..., v_rules.draft_picks, 9)` in `draft_create_pool`
 * (supabase/migrations/20261012024916_draft_rpcs.sql:757).
 */
export const SQL_DRAFT_PICKS_FALLBACK = 9;

/**
 * Redraft line cap when the pool's `redraft_max_lines` is NULL. Mirrors
 * `COALESCE(v_pool.redraft_max_lines, 3)` in `redraft_set_submission`
 * (supabase/migrations/20261012025023_redraft_rpcs.sql:35).
 */
export const SQL_REDRAFT_MAX_LINES_FALLBACK = 3;
