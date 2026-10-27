/**
 * What deleting a league (`DELETE /api/seasons/[id]` -> `moveLeagueToTrash`) does to the rows around it. The league
 * admin's Danger tab lists it. A delete is never refused for what the league still holds: the league moves to the
 * recycle bin (`supabase/migrations/20261026091000_league_trash.sql`), the superadmin can restore it for
 * `LEAGUE_TRASH_RETENTION_DAYS`, and after that it is gone.
 *
 * The lists are the SQL inventory, grouped for the hint:
 * - `owned` (`league_trash__inventory`, class `owned`): captured into the trash, deleted from the live tables, and
 *   brought back by a restore. Named groups for the hint, plus tables the hint does not name.
 * - `derived`: deleted with the league and NOT captured; statistics and ratings are recalculated without the league
 *   after the delete and again after a restore.
 * - `kept`: append-only logs that stay untouched (the audit log, the draft action log).
 * - `unlinked` (`league_trash__pointers`): rows OUTSIDE the league that point into it. They stay, lose the link, and get
 *   it back on a restore (`NOT_RELINKED`: the win-streak pointers are not re-linked; streaks are recalculated).
 *
 * Derived from the schema, not guessed: `__tests__/season-delete.test.ts` replays the migrations, reads the LAST
 * definition of the inventory and pointer functions, and fails when a table is added, dropped or reclassified there
 * without this file following. `src/lib/league-trash/__tests__/inventory.test.ts` is the guard that makes the SQL
 * inventory itself complete.
 *
 * Pure and client-safe: no reads.
 */

/** The groups of owned tables the hint names, in display order. */
export const SEASON_DELETE_GROUPS = [
  'participants',
  'groups',
  'rules',
  'phases',
  'matches',
  'draft',
  'teams',
  'evolution',
  'tokens',
  'redraft',
  'storylines',
  'connections',
] as const;
export type SeasonDeleteGroup = (typeof SEASON_DELETE_GROUPS)[number];

/** Owned tables per hint group. */
export const SEASON_DELETE_OWNED: Readonly<Record<SeasonDeleteGroup, readonly string[]>> = {
  participants: ['season_participants'],
  groups: ['season_groups', 'season_group_members'],
  rules: ['format_rules', 'season_formats', 'evolution_tiers', 'draft_tier_limits', 'draft_pool_entries'],
  phases: ['tournaments', 'tournament_participants', 'tournament_groups', 'tournament_group_members', 'rounds', 'tournament_reports'],
  matches: [
    'matches',
    'games',
    'battle_stats',
    'match_analyses',
    'match_prep_analyses',
    'match_prep_teams',
    'match_proposals',
    'match_evolution_snapshots',
    'epb_animation_views',
    'broadcast_moments',
  ],
  draft: ['draft_pools', 'draft_participants', 'draft_slots', 'draft_picks', 'draft_replay_events', 'draft_line_restrictions'],
  teams: ['teams'],
  evolution: ['evolution_tracker', 'evolution_events', 'evo_progress_log'],
  tokens: ['epb_token_grants', 'epb_draft_token_purchases', 'epb_comeback_token_spends'],
  redraft: ['redraft_slots', 'redraft_submissions', 'redraft_history', 'redraft_trade_requests'],
  storylines: ['season_storylines'],
  connections: ['resource_admins', 'discord_webhooks', 'social_integrations', 'wiki_notes', 'wiki_note_reports'],
};

/**
 * Owned tables the hint does not name: the league row itself, a baseline table the public app neither reads nor writes
 * (spec 4.13), and the internal EvoLiga kill-credit fence counter (`epb_kill_credit_epochs`, 20261021100100).
 * Listed so the schema check still accounts for every owned table.
 */
export const SEASON_DELETE_UNNAMED_OWNED: readonly string[] = ['seasons', 'legacy_standings', 'epb_kill_credit_epochs'];

/** Tables deleted with the league and not captured: recalculated, not restored. */
export const SEASON_DELETE_DERIVED: readonly string[] = ['aggregates', 'player_aggregates', 'aggregate_jobs', 'rating_history'];

/** Append-only logs: a delete and a restore leave them untouched. */
export const SEASON_DELETE_KEPT: readonly string[] = ['audit_log', 'draft_action_log'];

/** Tables outside the league whose rows point into it; they stay, and lose the link until a restore. */
export const SEASON_DELETE_UNLINKS: readonly string[] = ['cast_sessions', 'agent_suggestions', 'teams', 'player_streaks'];

/** The unlinked tables a restore does not link again (their pointers are recalculated instead). */
export const SEASON_DELETE_NOT_RELINKED: readonly string[] = ['player_streaks'];
