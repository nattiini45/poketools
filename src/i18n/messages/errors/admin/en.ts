/**
 * Error catalog `errors/admin` (owner A6 after the G0-ERR seed, i18n-core §4.1):
 * the admin API (`src/app/api/admin/**` minus the workbook imports and the
 * point-buy lists, which use `errors/draft-legacy`) and the test-account
 * helpers in `src/lib/supabase/queries/test-accounts.ts`.
 *
 * Keys are the existing `code` literals, copied verbatim, plus the codes A6
 * added (snake_case). `en` is the current English server message (templates
 * as `{param}` placeholders); the server keeps sending its own English
 * `error`, and clients translate by `code`.
 *
 * Shared codes reused by the admin routes instead of living here:
 * `errors/common` (`validation_failed`, `rate_limited`, `forbidden` for
 * "Admin access required", `invalid_json`), `errors/matches`
 * (`match_not_found`, `game_not_found`, `match_player_not_participant`,
 * `INVALID_PARAM`) and
 * `errors/tournaments` (`round_not_found`, `STRUCTURE_ELIM_ROUND_DELETE`).
 */
export default {
  // Test accounts (seeded by G0-ERR; thrown by queries/test-accounts.ts)
  not_a_test_account: 'Player is not a test account.',
  login_already_minted:
    'Login credentials are already being minted for this test account; refresh and try again.',
  test_player_action_invalid: 'action must be one of: {actions}',

  // Shared admin request checks
  admin_param_required: '{name} required',

  // Aggregate maintenance (api/admin/aggregates)
  aggregate_action_invalid: 'action must be drain or rebuild',
  aggregate_scope_type_invalid: 'scope_type must be tournament, league, or all_time',
  aggregate_scope_id_required: 'scope_id required for tournament and league scopes',

  // Record reconciliation (api/admin/reconcile)
  reconcile_body_not_object: 'Request body must be a JSON object',
  reconcile_repair_not_boolean: 'repair must be a boolean',
  reconcile_scope_invalid: 'scope must be season or all',
  reconcile_season_id_required: 'season_id required for season scope',

  // Games, rounds and replays (api/admin/{games,rounds,matches})
  game_edit_empty: 'Provide winner_id and/or battle_stats to update',
  round_delete_not_allowed: 'Only the latest round or rounds with zero games can be deleted',
  replay_import_winner_not_participant: 'Winner must be a match participant',

  // Player import (per-row results of api/admin/players/import)
  player_import_duplicate_discord_id: 'Duplicate discord_id in import payload',
  player_import_discord_id_exists: 'Player with discord_id already exists',

  // Data export (api/admin/export)
  admin_export_rate_limited: 'Export rate limit reached. Try again after {resetAt}.',
} as const;
