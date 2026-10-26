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

  // Rating rebuild integrity (src/lib/rating/updateRatings.ts; reconcile repair, match reset, entity deletes)
  rating_history_incomplete: {
    one: 'Rating history has gaps that no rebuild order can fill for {count} completed match (players: {players}). Those players were not rebuilt; a developer must restore the missing rating history rows.',
    other: 'Rating history has gaps that no rebuild order can fill for {count} completed matches (players: {players}). Those players were not rebuilt; a developer must restore the missing rating history rows.',
  },

  // Rating rebuild plan cap (src/lib/rating/updateRatings.ts): healing history gaps would pull in more than {limit} players (409, nothing written)
  rating_rebuild_plan_too_large:
    'Rebuilding these ratings would pull in more than {limit} players to heal rating history gaps, so nothing was rebuilt. A developer must inspect the rating history before rebuilding.',

  // Entity delete warnings (sent with a 200 in data.rebuild_warning by the season, tournament and phase DELETE routes):
  // the delete committed, the derived-data rebuild after it failed (details in the server log and the audit record).
  // One code per failed step (src/lib/api/delete-rebuild-warning.ts); derived_data_rebuild_failed for anything else.
  // A league admin may delete a phase, so the text names a site admin for the repair (the tools are site-admin only).
  derived_data_rebuild_failed:
    'The delete succeeded, but rebuilding the derived data (aggregates, ratings, streaks) afterwards failed. The failure was logged; a site admin can bring the records back in line with Repair in Record Reconciliation (admin data tools).',
  delete_rebuild_aggregates_failed:
    'The delete succeeded, but rebuilding the usage statistics (aggregates) afterwards failed. The failure was logged; a site admin can rebuild the aggregates in the admin data tools.',
  delete_rebuild_ratings_failed:
    'The delete succeeded, but rebuilding the ratings afterwards failed. The failure was logged; a site admin can repair them with Record Reconciliation in the admin data tools.',
  delete_rebuild_streaks_failed:
    'The delete succeeded, but rebuilding the win streaks afterwards failed. The failure was logged; a site admin can repair them with Record Reconciliation in the admin data tools.',
  delete_rebuild_evolution_failed:
    "The delete succeeded, but repairing the league's evolution progress afterwards failed. The failure was logged; a site admin can repair it with Record Reconciliation in the admin data tools.",

  // League restore warnings (sent with a 200 in data.rebuild_warning by POST /api/admin/league-trash/[id]/restore and
  // by the pending-rebuild route): the league is back, the derived-data rebuild after it failed or did not settle
  // (details in the server log and the audit record). The superadmin can run the pending rebuild again on the trash page.
  restore_rebuild_failed:
    'The league was restored, but rebuilding the derived data (statistics, ratings, streaks) afterwards failed. The failure was logged; run the pending rebuild on the trash page again.',
  restore_rebuild_aggregates_failed:
    'The league was restored, but counting its games into the usage statistics (aggregates) afterwards failed. The failure was logged; run the pending rebuild on the trash page again.',
  restore_rebuild_ratings_failed:
    'The league was restored, but rebuilding the ratings afterwards failed. The failure was logged; run the pending rebuild on the trash page again.',
  restore_rebuild_streaks_failed:
    'The league was restored, but rebuilding the win streaks afterwards failed. The failure was logged; run the pending rebuild on the trash page again.',
  restore_rebuild_evolution_failed:
    "The league was restored, but repairing the league's evolution progress afterwards failed. The failure was logged; run the pending rebuild on the trash page again.",
  restore_rebuild_ratings_unsettled:
    'The league was restored and the ratings were rebuilt, but they had not fully settled. Run the pending rebuild on the trash page again.',

  // Test-league flag warning (sent with a 200 in data.rebuild_warning by PATCH /api/seasons/[id]): the flag is
  // saved, the rating rebuild of the league's players after it failed (details in the server log and the audit record).
  test_flag_rating_rebuild_failed:
    "The test-league setting was saved, but rebuilding the league players' ratings afterwards failed. The failure was logged; a site admin can repair them with Record Reconciliation in the admin data tools, repeating the repair until its dry run lists no rating mismatch.",
  // The rebuild ran to its pass cap while a pass still changed ratings (rebuilt, not yet settled).
  test_flag_rating_rebuild_unsettled:
    "The test-league setting was saved and the league players' ratings were rebuilt, but they had not fully settled. A site admin can finish it with Record Reconciliation in the admin data tools, repeating the repair until its dry run lists no rating mismatch.",

  // Games, rounds and replays (api/admin/{games,rounds,matches})
  game_edit_empty: 'Provide winner_id and/or battle_stats to update',
  round_delete_not_allowed: 'Only the latest round or rounds with zero games can be deleted',
  replay_import_winner_not_participant: 'Winner must be a match participant',
  // Replay import: the replay fetched again hashes differently from the preview the organizer reviewed (409, nothing written)
  replay_changed_since_preview: 'The replay changed after it was previewed. Parse it again and review it before importing.',

  // Player import (per-row results of api/admin/players/import)
  player_import_duplicate_discord_id: 'Duplicate discord_id in import payload',
  player_import_discord_id_exists: 'Player with discord_id already exists',

  // Matches list bulk actions (POST /api/admin/matches/batch): per-item outcomes. A skip or a conflict wrote nothing for that match.
  match_bulk_not_pending: 'Only matches awaiting confirmation can be confirmed in bulk.',
  match_bulk_schedule_completed: 'The time of a completed match cannot be changed.',
  match_bulk_conflict: 'The match changed while the action ran, so nothing was changed. Reload the list and try again.',
  match_bulk_notes_full: 'The notes of this match are full, so the note was not added.',
  match_bulk_not_processed: 'The action ran out of time before this match, so nothing was changed. Run it again for the matches that are left.',
  match_bulk_item_failed: 'The action failed for this match. The failure was logged.',

  // Data export (api/admin/export)
  admin_export_rate_limited: 'Export rate limit reached. Try again after {resetAt}.',

  // Format library (api/formats/**, src/lib/format-studio/{errors,library}.ts). Statuses: src/lib/format-studio/errors.ts.
  format_not_found: 'Format not found',
  format_preset_not_found: 'Example format not found',
  format_stale_revision: 'This format was changed in the meantime. Reload it and apply your edit again.',
  format_slug_taken: 'This format address is already in use.',
  format_document_not_json: 'The format document is not valid JSON.',
  format_document_not_object: 'The format document must be a JSON object.',
  format_document_too_deep: 'The format document is nested too deeply.',
  format_document_too_many_nodes: 'The format document has too many entries.',
  format_document_too_large: 'The format document is too large (limit 256 KB).',
  format_document_too_large_to_store: 'The format document is too large to store.',
  format_document_name_required: 'The format document needs a valid name under identity.',
  format_publish_invalid: {
    one: 'This format has {count} error and cannot be published. Fix it first.',
    other: 'This format has {count} errors and cannot be published. Fix them first.',
  },
  format_nothing_to_publish: 'There are no changes since the latest published version.',
  format_not_published: 'This format has no published version yet.',
  format_published_locked: 'A format in the gallery can only be published by site admins.',
  format_visibility_forbidden: 'Only site admins can put a format in the gallery or change a gallery format.',
  format_preset_locked: 'Example formats can only be changed by site admins.',
  format_attached: {
    one: 'This format is attached to {count} league and cannot be deleted.',
    other: 'This format is attached to {count} leagues and cannot be deleted.',
  },
  format_has_versions: 'This format has published versions, so it cannot be deleted.',
  format_version_immutable: 'A published version cannot be changed.',

  // Ruleset library (api/ruleset-definitions/**, src/lib/ruleset-studio/{errors,library,pins}.ts). Statuses: src/lib/ruleset-studio/errors.ts.
  // `ruleset_not_found` lives in errors/tournaments.
  ruleset_forbidden: 'You cannot use this ruleset: it is private to another admin or has no published version.',
  ruleset_slug_taken: 'This ruleset address is already in use.',
  ruleset_stale_revision: 'This ruleset was changed in the meantime. Reload it and apply your edit again.',
  ruleset_document_not_json: 'The ruleset document is not valid JSON.',
  ruleset_document_not_object: 'The ruleset document must be a JSON object.',
  ruleset_document_too_deep: 'The ruleset document is nested too deeply.',
  ruleset_document_too_many_nodes: 'The ruleset document has too many entries.',
  ruleset_document_too_large: 'The ruleset document is too large (limit 256 KB).',
  ruleset_document_too_large_to_store: 'The ruleset document is too large to store.',
  ruleset_document_invalid: {
    one: 'This ruleset has {count} error and cannot be published. Fix it first.',
    other: 'This ruleset has {count} errors and cannot be published. Fix them first.',
  },
  ruleset_nothing_to_publish: 'There are no changes since the latest published version.',
  ruleset_not_published: 'This ruleset has no published version yet.',
  ruleset_published_locked: 'A ruleset in the gallery can only be published by site admins.',
  ruleset_visibility_forbidden: 'Only site admins can put a ruleset in the gallery or change a gallery ruleset.',
  ruleset_preset_locked: 'Site rulesets can only be changed by site admins.',
  ruleset_preset_unknown: 'Rule preset not found',
  ruleset_in_use: {
    one: 'This ruleset is used by {count} league or phase and cannot be deleted.',
    other: 'This ruleset is used by {count} leagues or phases and cannot be deleted.',
  },
  ruleset_version_immutable: 'A published version cannot be changed.',
  ruleset_legacy_editor_unsupported: 'This ruleset uses features the old ruleset editor cannot show (a preset base or an allowlist). Edit it in the ruleset studio.',
  ruleset_version_quota_exceeded: 'A ruleset can have at most {max} published versions.',
  ruleset_owner_quota_exceeded: 'You can own at most {max} rulesets. Delete one you no longer need.',
  ruleset_pin_mismatch: 'That version does not belong to this ruleset.',
  ruleset_pin_locked: 'This league or phase is finished, so its ruleset can no longer be changed.',
  ruleset_pin_started: 'This league or phase has already started. Move it to another ruleset version with the ruleset pin tool, which asks you to confirm.',
  ruleset_pin_confirm_required: 'This league or phase has already started. Confirm the change for: {targets}.',
  ruleset_pin_moved: 'The ruleset of {target} was changed by someone else while the move ran. The page now shows the current state; check it and try again. The ones before it were already moved.',
} as const;
