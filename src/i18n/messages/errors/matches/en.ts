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
  match_dispute_resolve_admin_only: 'Only admins can resolve disputed matches',
  match_complete_no_winner: 'Cannot complete a match without a winner',
  match_confirm_participants_only: 'Only match participants or admins can confirm results',
  match_dispute_participants_only: 'Only match participants or admins can dispute results',

  // Manual results and replays
  match_player_not_participant: 'Player {playerId} is not in this match',
  manual_result_winner_not_participant: 'Winner must be a match participant',
  replay_player_not_in_match: 'Player "{username}" ({player}) is not a participant in this match',
  replay_winner_unknown: 'Could not determine winner from replay',

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
} as const;
