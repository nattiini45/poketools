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
  PHASE_NAME_TAKEN: 'Another phase of this league already has this name.',
  PHASE_DELETE_CONFIRM_REQUIRED: 'Deleting a phase with rounds requires confirm: true',
  PHASE_STAGE_ORDER_LOCKED: 'Stage order cannot be changed once the phase has started',
  PHASE_BRACKET_LOCKED: 'Bracket type cannot be changed once the phase has started',
  PHASE_PARTICIPANTS_LOCKED: 'Participants cannot be changed on a completed phase',
  PHASE_ROSTER_REQUIRED: 'All enrollees must be league roster members',
  PHASE_GROUP_INVALID: 'Invalid group for this phase',
  PHASE_GROUP_MEMBER_NOT_FOUND: 'Player is not in the source group',
  PHASE_GROUPS_INSUFFICIENT_SEEDS: 'Need at least as many seeded participants as groups',
  // League groups: a grouped league's phases mirror its groups (league groups editor, Participants tab)
  PHASE_GROUPS_LEAGUE_MANAGED:
    "This league has groups, so its phases follow them. Change the groups in the league's Participants tab.",
  PHASE_PLAYER_WITHOUT_LEAGUE_GROUP: {
    one: '{count} trainer of this phase is in no league group. Place them in the Participants tab first.',
    other: '{count} trainers of this phase are in no league group. Place them in the Participants tab first.',
  },
  PHASE_GROUPS_STALE: 'The league groups changed while the round was being generated; generate it again',
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
  // Path ids that are not UUIDs name no row (404 before the query; src/lib/api/invalid-path-id.ts)
  INVALID_SEASON_ID: 'League not found',
  INVALID_PHASE_ID: 'Phase not found',
  INVALID_GROUP_ID: 'Group not found',
  // League groups editor (api/seasons/[id]/groups/**); database refusals (SEASON_GROUP_LOCKED, ...) are errors/draft codes
  SEASON_GROUP_NOT_FOUND: 'Group not found in this league',
  SEASON_GROUP_NAME_TAKEN: 'Another group of this league already has this name',
  SEASON_GROUP_PLAYER_NOT_FOUND: 'This trainer is not a participant of this league',
  SEASON_GROUPS_TOO_MANY: 'Cannot split {participants} participants into {count} groups: every group needs at least two trainers.',
  SEASON_GROUPS_INCOMPLETE: {
    one: '{count} participant is in no group. Place every participant in exactly one group.',
    other: '{count} participants are in no group. Place every participant in exactly one group.',
  },
  SEASON_NOT_FOUND: 'League not found',
  // League DELETE refused by a row that still points at the league without ON DELETE (SQLSTATE 23503; 409)
  SEASON_HAS_DEPENDENTS:
    'This league still has phases, draft pools, teams or storylines that point to it, so nothing was deleted. Delete those first, then delete the league.',
  // League settings (PATCH /api/seasons/[id], POST /api/seasons)
  SEASON_FORMAT_LOCKED: 'The league type cannot be changed once the league has started.',
  SEASON_FORMAT_POINT_BUY_LOCKED:
    'A point-buy league keeps its league type, and other leagues cannot be switched to it.',
  SEASON_DATES_INVALID: 'The end date must not be before the start date.',
  // Starting a league from another one (POST /api/seasons with clone_from)
  SEASON_CLONE_FORBIDDEN: 'You can only start a league from a league you administer.',
  SEASON_CLONE_ADMINS_FORBIDDEN: 'Only site admins can copy the league admins.',
  SEASON_CLONE_CUSTOM_FORMAT:
    'A league with a custom format cannot be used as a source: its phases come from an attached format, and a copy could not attach one.',
  SEASON_CLONE_FAILED: 'The league could not be created from the source. Nothing was kept.',
  SEASON_CLONE_CLEANUP_FAILED:
    'The league could not be created from the source, and it could not be removed again: league {league_id} remains with {phases} phases and {participants} roster entries. A site admin can delete it.',
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
  SUBSTITUTE_LEAGUE_GROUP_MISMATCH:
    'The incoming player is not in league group {group}, which {phase} follows; substitute across the whole league instead',

  // Custom format (Format Studio): attach, detach and readiness (api/seasons/[id]/format, src/lib/format-studio/errors.ts)
  format_season_not_custom: 'This league does not use a custom format.',
  format_season_started: 'The league has already started, so its format can no longer be changed.',
  format_attach_forbidden: 'You can only attach formats that you own or that are shared with all admins.',
  format_attach_invalid: 'This version has errors and cannot be attached ({first}).',
  format_attach_ruleset_required: {
    one: "{count} stage uses the league's default ruleset, but the league has none. Set a default ruleset first.",
    other: "{count} stages use the league's default ruleset, but the league has none. Set a default ruleset first.",
  },
  format_attach_manual_phases: {
    one: 'This league already has {count} phase that was not created from a format. Delete it first.',
    other: 'This league already has {count} phases that were not created from a format. Delete them first.',
  },
  format_not_attached:
    'This league uses a custom format, but none is attached yet. Attach a format before the league starts.',
  format_nothing_attached: 'No format is attached to this league.',
  format_detach_blocked: 'Teams still point to a phase of this format, so it cannot be detached.',
  season_format_type_locked:
    'The league type cannot be switched to or from a custom format while a format is attached or after the league has started.',
} as const;
