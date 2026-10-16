/**
 * Error catalog `errors/seasons` (owner A5 after the G0-ERR seed, i18n-core §4.1).
 *
 * Covers the non-draft season routes (`api/seasons/{route,me}`,
 * `api/seasons/[id]/{route,advance,cores,format-rules,participants,phases}`)
 * and `src/lib/season`.
 *
 * The seeded keys are the existing `code` literals, copied verbatim; keys
 * added by A5 are snake_case. `en` is the English server message (templates
 * as `{param}` placeholders); the server keeps sending its own English
 * `error`, which clients show in English. A code shared by several messages
 * carries the params of the most specific one.
 */
export default {
  // Phases (league stages)
  PHASE_NOT_FOUND: 'Phase not found in this league',
  PHASE_NOT_ELIGIBLE: 'Phase not found or is already completed',
  PHASE_REORDER_LOCKED: 'Only upcoming phases can be reordered',
  PHASE_REORDER_INCOMPLETE: 'phase_ids must include every upcoming phase exactly once',
  PHASE_INSERT_INVALID: 'insert_at is out of range',
  PHASE_INSERT_LOCKED: 'Cannot insert a phase before stages that have already started',
  PHASE_COMPLETED_LOCKED: 'Completed phases are locked. Reopen to active first.',
  PHASE_DELETE_CONFIRM_REQUIRED: 'Deleting a phase with rounds requires confirm: true',
  PHASE_STAGE_ORDER_LOCKED: 'Stage order cannot be changed once the phase has started',
  PHASE_BRACKET_LOCKED: 'Bracket type cannot be changed once the phase has started',
  PHASE_PARTICIPANTS_LOCKED: 'Participants cannot be changed on a completed phase',
  PHASE_ROSTER_REQUIRED: 'All enrollees must be league roster members',
  PHASE_GROUP_INVALID: 'Invalid group for this phase',
  PHASE_GROUP_MEMBER_NOT_FOUND: 'Player is not in the source group',
  PHASE_GROUPS_INSUFFICIENT_SEEDS: 'Need at least as many seeded participants as groups',
  PLAN_CHANGED: 'The group rows changed since they were checked; check them again',
  GROUP_SLOT_CHANGED: 'The groups changed in the meantime; check them again',
  phase_seed_duplicate: 'Duplicate seed values are not allowed',
  phase_seed_not_participant: 'Player {player_id} is not a participant',
  phase_seed_no_participants: 'No participants to seed',
  // Advancing between phases
  advance_needs_two_phases: 'Need at least 2 phases to advance',
  advance_no_transition:
    'No valid phase transition found. Need a completed phase followed by an upcoming phase.',
  // Seasons, roster, cores, format
  season_not_found: 'Season not found',
  SEASON_NOT_FOUND: 'League not found',
  season_test_flag_site_admin_only: 'Only site admins can change the test-league flag',
  participant_update_empty: 'Provide gym_type and/or core_types to update',
  format_mismatch: 'This season does not use the Evolution Point Buy format',
  core_pool_missing: 'Season has no core pool configured',
  core_no_participants: 'Season has no participants to assign cores to',
  core_assignment_error: 'The core pool is too small: {available} available, {needed} needed.',
  core_pool_empty: 'Core pool is empty; cannot draw cores',
  core_pool_entry_invalid: 'Pool entry has wrong length: {entry}',
  core_pool_entry_duplicate_types: 'Pool entry contains duplicate types: {entry}',
  core_pool_duplicate_triple: 'Pool contains duplicate triple: {types}',
  core_types_conflict: '{types} is already assigned to another participant',
  core_not_in_pool: '{types} is not in the season core pool',
  // Substitution
  SEASON_CLOSED: 'The league is closed; its roster can no longer be substituted',
  substitute_same_player: 'Outgoing and incoming players must be different',
  ENROLLMENT_CHANGED:
    'Outgoing player is no longer enrolled in {phase} (the phase changed during the substitution); check it again',
  ROSTER_CHANGED:
    'Outgoing player is not on the league roster any more (the roster changed during the substitution); check it again',
  OUT_PLAYER_NOT_FOUND: 'Outgoing player not found',
  IN_PLAYER_NOT_FOUND: 'Incoming player not found',
  OUT_NOT_ON_ROSTER: 'Outgoing player is not on the league roster',
  IN_ALREADY_ON_ROSTER: 'Incoming player is already on the league roster',
  OUT_NOT_IN_PHASE: 'Outgoing player is not enrolled in this phase',
  IN_ALREADY_IN_PHASE: 'Incoming player is already enrolled in {phase}',
} as const;
