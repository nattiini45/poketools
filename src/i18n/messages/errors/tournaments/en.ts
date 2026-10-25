/**
 * Error catalog `errors/tournaments` (owner A3 after the G0-ERR seed, i18n-core §4.1):
 * tournaments, participants and seeding, rounds (generate, manual, re-pair),
 * elimination brackets, rulesets, the ruleset seeder and resource admins,
 * plus the seed errors of `src/lib/tournament/seed-errors.ts`.
 *
 * Keys are the existing `code` literals, copied verbatim, plus the codes A3
 * added (snake_case). `en` is the current English server message (templates
 * as `{param}` placeholders); the server keeps sending its own English
 * `error`, and clients translate by `code`. Zod failures use
 * `errors/common.validation_failed`.
 *
 * Resource not-found codes owned here (`tournament_not_found`,
 * `round_not_found`, `ruleset_not_found`) are the ones other domains reuse.
 */
export default {
  STRUCTURE_ELIM_ROUND_DELETE:
    'Structure-generated elimination rounds cannot be deleted individually. Use Regenerate Bracket to rebuild the slot graph.',
  BRACKET_V2_MANAGED:
    'This tournament bracket is managed by the bracket engine. Use Generate Bracket or Regenerate Bracket instead.',
  BRACKET_LOCKED_USE_SUBSTITUTE:
    'Bracket seat count is fixed after generation — use substitute or regenerate bracket.',
  INVALID_ROUND_ID: 'Round not found',
  // The server text has a literal `{id}` path segment; the formatter has no
  // brace escape, so the seed writes `‹id›` to keep it from parsing as a param.
  TOURNAMENT_SEASON_ID_DEPRECATED: 'League phases must be created via POST /api/seasons/‹id›/phases',
  REGENERATE_PLAYED: {
    one: '{count} played match will be reset and all results rolled back.',
    other: '{count} played matches will be reset and all results rolled back.',
  },
  ENROLLMENT_FROZEN: 'Enrollment is frozen. Confirm to overwrite imported standings.',
  ENROLLMENT_ROUNDS_EXIST: 'Enrollment cannot be re-synced while rounds exist. Confirm to overwrite.',
  SEED_CONFLICT:
    'Seed {seed} is already held by another participant — include them in the reseed or pick a free seed.',
  SEED_UPDATE_PARTIAL: {
    one: 'Seeding was only partly saved — {count} participant could not be updated. Reload and save the seeding again.',
    other:
      'Seeding was only partly saved — {count} participants could not be updated. Reload and save the seeding again.',
  },

  // Tournaments
  tournament_not_found: 'Tournament not found',
  // A path id that is not a UUID names no tournament (404 before the query)
  INVALID_TOURNAMENT_ID: 'Tournament not found',
  INVALID_RULESET_ID: 'Ruleset not found',
  tournament_already_completed: 'Tournament is already completed',
  // Settings of a started standalone tournament (PATCH /api/tournaments/[id])
  tournament_bracket_locked: 'The bracket type cannot be changed once the tournament has started.',
  tournament_ruleset_locked: 'The ruleset cannot be changed once the tournament has started.',
  tournament_doubles_locked: 'The doubles setting cannot be changed once the tournament has started.',
  tournament_participants_too_few: 'Need at least 2 participants',
  tournament_current_round_incomplete: 'Current round ({round}) is not yet completed',

  // Participants and seeding
  tournament_participant_add_locked: 'Cannot add participants after the tournament has started',
  tournament_participant_remove_locked: 'Cannot remove participants after the tournament has started',
  tournament_seeding_locked: 'Seeding is locked — the tournament has already started',
  tournament_seed_duplicate: 'Duplicate seed values are not allowed',
  tournament_player_not_participant: 'Player {player} is not a participant',

  // Rounds
  round_not_found: 'Round not found',
  round_wrong_tournament: 'Round does not belong to this tournament',
  round_best_of_locked: 'Can only change best_of on pending rounds',
  rounds_round_robin_only: 'Generate-all-rounds is only supported for round_robin tournaments',
  rounds_all_generated: 'All rounds have already been generated',
  rounds_round_already_written: '{round} already exists with its matches. Delete it to generate it again.',
  // League groups: placement weeks pair the same-placed trainers by the group tables after the week before
  rounds_group_placement_not_ready:
    'Week {week} is a placement week. Finish every match of the weeks before it, then generate it.',
  rounds_group_layout_invalid:
    'The phase groups cannot be scheduled: every group needs a trainer, and every trainer exactly one group',
  rounds_group_schedule_unbalanced: 'The phase groups cannot be split into two balanced halves of the season',
  rounds_double_elim_starters_too_few: 'Double elimination needs at least 2 upper-bracket starters',
  rounds_manual_league_grouped:
    'This league has groups, so its table phase follows the week plan. Use Generate Next Round instead.',

  // Manual rounds (pairings)
  pairing_players_missing: 'Each pairing must have player_1_id and player_2_id',
  pairing_self: 'A player cannot be paired against themselves',
  pairing_player_repeated: 'Player {player} appears in multiple pairings',
  pairing_players_unpaired: {
    one: 'All participants must be paired. {count} participant is not in any pairing.',
    other: 'All participants must be paired. {count} participants are not in any pairing.',
  },

  // Elimination brackets
  bracket_generate_elim_only: 'Full bracket generation only applies to elimination formats',
  bracket_regenerate_elim_only: 'Bracket regeneration only applies to elimination formats',
  bracket_repair_elim_only: 'Bracket repair only applies to elimination formats',

  // Re-pairing one match
  repair_match_not_found: 'Match not found',
  repair_match_wrong_round: 'Match does not belong to this round',
  repair_match_wrong_tournament: 'Match does not belong to this tournament',
  repair_match_status_locked: 'Only scheduled or in-progress matches can be re-paired',
  repair_match_has_games: 'Cannot re-pair a match with submitted games. Reset the match first.',
  repair_round_not_found: 'Round not found for this tournament',
  repair_players_not_participants: 'Both players must be tournament participants',

  // Rulesets and the ruleset seeder
  ruleset_not_found: 'Ruleset not found',
  seed_rulesets_admin_required: 'Admin authentication required.',
  seed_rulesets_secret_invalid: 'Invalid or missing bootstrap secret.',

  // Resource admins
  resource_admin_target_required: 'resource_type and resource_id are required',
} as const;
