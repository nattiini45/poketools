/**
 * Error catalog `errors/matches` (owner A4 after the G0-ERR seed, i18n-core §4.1):
 * matches, confirm-match, manual-result, match proposals, parse-replay, the
 * non-draft cron routes and the game pipeline (`src/lib/pkmn/game-pipeline.ts`).
 *
 * Keys are the existing `code` literals, copied verbatim, plus the codes A4
 * added (snake_case). `en` is the current English server message (templates
 * as `{param}` placeholders); the server keeps sending its own English
 * `error`, and clients translate by `code`. Zod failures use
 * `errors/common.validation_failed`, rate limits `errors/common.rate_limited`.
 *
 * Resource not-found codes owned here (`match_not_found`,
 * `game_not_found`, `match_proposal_not_found`) are the ones other domains reuse.
 */
export default {
  INVALID_MATCH_ID: 'Match not found',
  STORAGE_REMOVE_FAILED: 'Failed to remove social image file',
  MISSING_PARAM: '{name} is required',
  INVALID_PARAM: '{name} must be a valid UUID',
  SAME_PLAYER: 'player_1_id and player_2_id must differ',
  name_mismatch:
    'Could not match PS username "{username}" to a registered player. Players must set their PS username in their profile.',
  duplicate_replay: 'This replay URL was already submitted for a game in this match.',
  DOWNSTREAM_PLAYED: {
    one: '{count} downstream match has results or is in progress. Pass cascade: true to reset the whole chain.',
    other: '{count} downstream matches have results or are in progress. Pass cascade: true to reset the whole chain.',
  },

  // Matches
  match_not_found: 'Match not found',
  match_access_required: 'Match access required',
  game_not_found: 'Game not found',

  // Confirm / dispute a result
  match_override_admin_only: 'Only admins can override match winner or notes',
  match_winner_not_participant: 'Winner must be one of the match participants',
  match_confirm_own_submission: 'Cannot confirm your own submission',
  // Status transitions (`validateTransition` in src/lib/tournament/match-state.ts)
  match_transition_invalid: 'Invalid transition: {from} → {to}',
  match_reset_admin_only: 'Only admins can reset match state',
  match_status_override_admin_only: 'Only admins can complete or dispute a match that is still in progress',
  match_dispute_resolve_admin_only: 'Only admins can resolve disputed matches',
  match_complete_no_winner: 'Cannot complete a match without a winner',
  // confirm-match: the guarded status update missed and the match is now in a different state (409, nothing written)
  match_state_changed: 'The match changed to {status} while you were editing it. Review it and try again.',
  match_confirm_participants_only: 'Only match participants or admins can confirm results',
  match_dispute_participants_only: 'Only match participants or admins can dispute results',

  // Manual results and replays
  match_player_not_participant: 'Player {playerId} is not in this match',
  manual_result_winner_not_participant: 'Winner must be a match participant',
  replay_player_not_in_match: 'Player "{username}" ({player}) is not a participant in this match',
  replay_winner_unknown: 'Could not determine winner from replay',
  // A replay's battle is bound to at most one game, in any match (games.replay_hash, unique; 409, nothing written)
  replay_already_recorded: 'This replay was already used to record a game result. Each battle can be recorded only once.',
  // Both replay sides resolved (or were assigned) to the same registered player (400, nothing written)
  replay_sides_not_distinct: 'Both sides of the replay belong to the same player.',
  // battle_stats unique (game_id, player_id, lower(btrim(pokemon_name))): one Pokémon twice for one player in a game (409, nothing written)
  battle_stats_duplicate_pokemon:
    'A Pokémon appears twice for the same player in this game. Each Pokémon can be recorded once per player and game.',
  // Two submissions for one match raced for the same game number (games_match_id_game_number_key)
  match_result_conflict: 'Another result was recorded for this match at the same moment. Reload the match and submit again.',
  // confirm-match: the completion is saved, but finalize steps failed (details in the server log and the match.finalize_failed audit event)
  match_finalize_incomplete: {
    one: 'The result was confirmed, but {count} follow-up step failed. The failure was logged for the admins; safe steps are retried automatically.',
    other: 'The result was confirmed, but {count} follow-up steps failed. The failure was logged for the admins; safe steps are retried automatically.',
  },
  // manual-result warning (sent with a 200): the game is recorded, its tracker moments were not saved (details in the server log)
  manual_result_moments_not_saved: {
    one: 'The game was recorded, but its {count} marked moment could not be saved. The failure was logged.',
    other: 'The game was recorded, but its {count} marked moments could not be saved. The failure was logged.',
  },
  // Admin game edit/delete: the game change is saved, but the match status changed concurrently and was not re-evaluated
  admin_game_match_status_conflict:
    'The game change was saved, but the match changed at the same moment, so its status was not re-evaluated. Reload the match and check its status.',
  // Admin game edit/delete: another admin rolled back or re-applied the same game between this request's read and its rollback (nothing written)
  admin_game_changed_concurrently:
    'This game was changed by another admin at the same moment. Nothing was changed by this request; reload the match and try again.',
  // Admin game edit (optimistic concurrency): the game is no longer at the version the editor loaded, moved on by another edit, an earlier save attempt from the same editor, or the aggregate queue (409, nothing written)
  admin_game_edit_stale:
    'This game changed after you opened the editor (an edit was saved or attempted, possibly your own earlier save, or its statistics were counted). Nothing was saved; reload the page and make your change again.',
  // Admin game edit (edit lease): another edit of the same game is running right now (409, nothing written)
  admin_game_edit_in_progress:
    'Another edit of this game is being saved right now. Nothing was saved; wait a moment, reload the page and make your change again.',
  // Admin game delete: the rollback committed, then a concurrent edit counted the game again, so the fenced delete removed nothing (409)
  admin_game_delete_recounted:
    "Another admin's edit counted this game again at the same moment, so it was not deleted. Its statistics match the game as it now stands; reload the match and delete it again if you still want to.",
  // Admin game edit/delete: the change failed and queueing the game to be counted again failed too (500; both errors logged)
  admin_game_left_uncounted:
    'The game change failed, and the game could not be queued to be counted again, so it may be missing from the statistics. Rebuild the aggregates of its tournament and season (admin data tools).',
  // Admin game edit/delete/match reset warning (sent with a 200 in the result's evolution_recheck_failed): the change is saved, the EPB evolution recheck failed (details in the server log)
  admin_game_evolution_recheck_failed:
    'The game change was saved, but re-checking the evolution progress failed. The failure was logged; run Repair in Record Reconciliation (admin data tools) to fix the evolution state.',
  // Admin match reset: a game rollback lost a race after {count} sibling game(s) were already removed; the match fields were not reset (409, retry finishes it)
  admin_match_reset_partial: {
    one: "The reset stopped because another admin changed one of this match's games at the same moment. {count} game was already removed (its statistics rolled back); the match itself was not reset. Reload the match and reset it again.",
    other: "The reset stopped because another admin changed one of this match's games at the same moment. {count} games were already removed (their statistics rolled back); the match itself was not reset. Reload the match and reset it again.",
  },
  // Admin match reset of a match that is already scheduled
  match_already_scheduled: 'Match is already in scheduled state',

  // Scheduling proposals
  match_proposal_not_found: 'Proposal not found',
  match_proposal_participants_only: 'Only match participants can propose a time',
  match_proposal_match_closed: 'Cannot propose times for completed or disputed matches',
  match_proposal_time_past: 'Proposed time must be in the future',
  match_proposal_pending_exists: 'A pending proposal already exists for this match',
  match_proposal_accept_responder_only: 'Only the responder can accept this proposal',
  match_proposal_reject_responder_only: 'Only the responder can reject this proposal',
  match_proposal_not_pending: 'Proposal is no longer pending',
  match_proposal_expired: 'Proposal has expired',
  match_schedule_closed: 'Cannot schedule completed or disputed matches',

  // Social image (admin)
  match_social_image_invalid: 'Invalid image data',
  match_social_image_not_png: 'Only PNG images are accepted',
  match_social_image_too_large: 'Image too large (max 5MB)',
  match_social_image_upload_failed: 'Failed to upload social image',

  // Cron routes (auto-confirm, process-aggregates, refresh-usage-stats)
  cron_not_configured: 'Cron not configured',
  cron_unauthorized: 'Unauthorized',
  // process-aggregates: queue rows that can never drain (pending with attempts exhausted, or stuck processing)
  aggregate_jobs_stranded: 'Aggregate jobs are stranded ({stranded} unclaimable, {stale} stuck processing)',
  // process-aggregates: the claim RPC failed (nothing was applied)
  aggregate_claim_failed: 'Failed to claim aggregate jobs',
  // process-aggregates: the reclaim RPC or a queue write failed during the run
  aggregate_queue_failed: 'Failed to process aggregate jobs',
  // process-aggregates: the queue health probe failed after the run
  aggregate_health_failed: 'Failed to check aggregate job health',
  // auto-confirm: some matches could not be confirmed or finalized (details in the server log)
  auto_confirm_partial_failure: {
    one: 'Auto-confirm run finished with {count} failed match.',
    other: 'Auto-confirm run finished with {count} failed matches.',
  },
  INVALID_GAME_ID: 'Game not found',
  INVALID_PROPOSAL_ID: 'Proposal not found',
} as const;
