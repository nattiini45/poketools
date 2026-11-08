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
  BRACKET_V2_REQUIRED:
    'Elimination brackets are built by the bracket engine. Use Generate Bracket instead.',
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
  ENROLLMENT_SYNC_CONFLICT: 'Another enrollment sync of this phase was running at the same time. Try again.',
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
  rounds_manual_pairing: 'This phase is paired by hand. Create its rounds in the manual round editor.',
  rounds_challenge_ladder:
    'This phase is a challenge ladder: its matches come from accepted challenges. Create its rounds in the manual round editor.',
  rounds_stage_ended: 'This phase has reached its end condition: no more rounds can be generated.',
  format_not_ready:
    'This phase cannot start its first round yet: a relation the format needs (for example a draw) has not been made, or players still owe an action. Fix it, or start anyway with force.',
  auto_advance_failed: 'The phase is completed, but moving players on to the next phase failed. Move them on by hand.',
  /** A warning, not an error: the round was generated. */
  swiss_rematches: {
    one: 'This round repeats {count} earlier pairing: no other opponent was left.',
    other: 'This round repeats {count} earlier pairings: no other opponents were left.',
  },
  /** A warning, not an error: the round was generated. */
  pairing_forbidden: {
    one: 'This round has {count} pairing that the phase filter rejects: no other pairing was possible, or it was dropped from the schedule.',
    other: 'This round has {count} pairings that the phase filter rejects: no other pairings were possible, or they were dropped from the schedule.',
  },
  rounds_round_already_written: '{round} already exists with its matches. Delete it to generate it again.',
  round_matches_unfinished: {
    one: '{round} still has {count} unfinished match. Finish it, or complete the round anyway with a reason.',
    other: '{round} still has {count} unfinished matches. Finish them, or complete the round anyway with a reason.',
  },
  rounds_previous_matches_unfinished: {
    one: '{round} still has {count} unfinished match, so the next round cannot be built from it. Finish it first.',
    other: '{round} still has {count} unfinished matches, so the next round cannot be built from it. Finish them first.',
  },
  round_robin_schedule_drift:
    '{round} would repeat a pairing that is already scheduled in this tournament. A participant was renamed or replaced after the first round; create this round by hand instead.',
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
  bracket_already_generated: 'Bracket already generated',
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
  // DELETE of a ruleset that a league in the trash still uses (league_trash_rulesets; 409)
  ruleset_in_trashed_league:
    'A league in the trash still uses this ruleset, so it was not deleted. Restore or permanently remove that league first.',
  seed_rulesets_admin_required: 'Admin authentication required.',
  seed_rulesets_secret_invalid: 'Invalid or missing bootstrap secret.',

  rounds_batch_end_when_expression:
    'This phase ends by a condition that is checked after every round, so its rounds cannot be generated all at once. Generate them one round at a time.',
  rounds_end_when_round_open:
    'This phase ends by a condition that is checked when a round is finished. Finish the open matches of {round} before creating the next round, so the condition can be checked first, or complete {round} anyway with a reason.',
  rounds_mirrored_groups_legs:
    'This round robin plays more than one leg, but its groups are managed by the league and follow the league week plan, which has no legs. Use a single leg, or remove the league groups.',
  // The phase completed (a stage end, or an admin) between the generator's checks and its write; nothing was written (409).
  rounds_phase_completed: 'This phase was completed while the round was being created, so no round was written. No more rounds can be generated.',
  // A round delete, reset or bracket regenerate went through, but the league format could not take back the effects of a result that no longer stands (warning, 200).
  round_format_revert_failed:
    "The round was changed, but the league format's effects of some results that no longer stand (item grants, points) could not be taken back. The failure was logged. Check the league's adjustments for the points and items of those results.",
  // A format could not react to a phase status change (warning, 200).
  format_reaction_failed:
    "The phase status was saved, but the league format's reaction to it (stage start or end, tie checks) did not run. Send the same status again to repeat it.",
  // A match of the round changed (a result, an accepted challenge) between the admin's reset and the delete; nothing was deleted (409).
  round_changed: 'A match of this round changed while it was being deleted, so nothing was deleted. Reload the round and try again.',
  // The round a retry meant to fill is completed (an admin completed it empty, or a completion won the race with the write); no match was written (409).
  rounds_round_completed: '{round} is already completed, so no matches were written into it. Delete it to generate it again.',

  // Resource admins
  resource_admin_target_required: 'resource_type and resource_id are required',
} as const;
