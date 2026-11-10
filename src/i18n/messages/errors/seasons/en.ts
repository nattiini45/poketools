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
  advance_manual_list_required: 'This advancement needs the list of players who move on.',
  advance_threshold_failed: 'The advancement condition could not be checked for every player.',
  groups_forming_in_progress: 'Another request is forming the groups of this phase right now. Try again in a moment.',
  pairing_expr_failed: 'The filter of this stage could not be evaluated for a pair of players, so the round was not paired.',
  // Seasons, roster, cores, format
  season_not_found: 'Season not found',
  // Path ids that are not UUIDs name no row (404 before the query; src/lib/api/invalid-path-id.ts)
  INVALID_SEASON_ID: 'League not found',
  INVALID_PHASE_ID: 'Phase not found',
  INVALID_GROUP_ID: 'Group not found',
  INVALID_LEAGUE_TRASH_ID: 'Trashed league not found',
  INVALID_CHALLENGE_ID: 'Challenge not found',
  INVALID_CHECK_ID: 'Check not found',
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
  format_attach_ruleset_forbidden: 'You can only use rulesets that you own or that are shared with all admins.',
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
  // Another admin switched the league's engine between the read and the write (409).
  format_engine_changed: "The league's format engine was changed in the meantime. Reload the page and try again.",
  format_detach_blocked: 'Teams still point to a phase of this format, so it cannot be detached.',
  // A replace removes a phase that teams still point to (409).
  format_phases_in_use: 'Teams still point to a phase that this format change would remove. Remove those teams first.',
  // A phase created from the league's format, or a hand-made one on a format league, is changed outside the format (409).
  format_phase_owned:
    'This phase belongs to the format of this league, so it cannot be added, deleted, reordered or restructured, and its roster and status cannot be changed through this request. Replace the format, change the status in the phase settings, or use a substitute for a player.',
  format_runtime_has_data:
    'This league already has data from its current format: {links} links, {items} items, {submissions} submissions and {adjustments} adjustments. Replacing or detaching the format deletes all of it. Confirm to continue.',
  season_format_type_locked:
    'The league type cannot be switched to or from a custom format while a format is attached or after the league has started.',
  // New-competition wizard (POST /api/seasons with from_format, src/lib/format-studio/create-league.ts): the one transaction
  // failed for a reason no other code names (500); it rolled back, so nothing was created.
  season_format_create_failed: 'The league could not be created from this format. Nothing was created. Try again.',
  action_locked: 'This action is locked, so it can no longer be changed.',
  resource_item_taken: 'Another player already holds this item, so it cannot be picked again.',
  resource_capacity_reached: 'This player already holds as many of this resource as it allows, so nothing more can be added.',
  format_context_stale: 'The league format changed while you were working, so your change was not saved. The view has been refreshed: check it and try again.',
  domain_amendment_locked: 'This list cannot be amended because an action that uses it is already locked.',
  reason_required: 'A reason is required for this adjustment.',
  reason_too_long: 'The reason is too long: it can have at most 500 characters.',

  // Challenge ladder (format_challenges): the signals of format_challenge_*, and the checks of the engine.
  challenge_self: 'You cannot challenge yourself.',
  challenge_phase_not_found: 'This phase does not belong to the league.',
  challenge_phase_closed: 'This phase is completed, so it takes no more challenges.',
  challenge_not_participant: 'Both players have to take part in this phase.',
  challenge_no_open_round: 'This phase has no open round yet. An admin has to open a round first.',
  challenge_rank_range: 'You can only challenge a player ranked above you, within the range this ladder allows.',
  challenge_max_open: 'You have reached the number of open challenges this ladder allows.',
  challenge_already_open: 'There is already an open challenge between you and this player.',
  challenge_cooldown: 'You challenged this player too recently. Wait a few rounds before you do it again.',
  challenge_not_found: 'This challenge does not exist.',
  challenge_not_defender: 'Only the challenged player can answer this challenge.',
  challenge_not_challenger: 'Only the player who made this challenge can withdraw it.',
  challenge_not_open: 'This challenge has already been answered, withdrawn or has expired.',
  challenge_expired: 'The time to answer this challenge has run out.',
  challenge_player_not_enrolled: 'One of the two players is no longer part of this phase, so the challenge was cancelled.',
  challenge_not_ladder: 'This phase is not a challenge ladder.',
  // The league's engine is not the kit (an admin switched it): a challenge can neither be made nor accepted until it is back (409).
  challenge_ladder_inactive: 'The challenge ladder of this league is not running at the moment, so challenges cannot be made or accepted. You can still decline or withdraw one.',

  // Live format surface (api/seasons/[id]/format/{me,actions,challenges,adjustments,checks,relations}): the refusals of
  // src/lib/format-engine/runtime/refusal.ts, plus the body of an action submission that has problems.
  format_not_running: 'This league is not running a custom format right now.',
  format_not_participant: 'You are not a participant of this league.',
  format_season_closed: 'This league is closed, so no more moves can be made.',
  // The audit write of an unmask failed, so nothing was shown (503, retry).
  unmask_audit_unavailable: 'The hidden relations could not be shown because the read could not be recorded. Try again in a moment.',
  format_action_unknown: 'This action does not exist in this league.',
  format_action_already_submitted: 'You have already submitted this action. Submit again to change your pick.',
  format_action_invalid: 'The submission has problems.',
  format_adjust_not_allowed: 'This format does not allow this kind of adjustment.',
  format_adjust_unknown_target: 'The adjustment points at something that is not part of this league.',
  format_adjust_invalid_amount: 'This amount is not valid for the adjustment.',
  format_adjust_invalid_links: 'These links do not fit the relation: they may only name players of the league and must follow the type of the relation.',
  format_adjust_invalid_order: 'The order has to list every player of the stage exactly once.',
  format_adjust_unknown_item: 'This item is not an entry of the list this resource holds.',
  format_adjust_item_required: 'This resource holds entries of a list, so the adjustment has to name the item.',
  format_adjust_item_not_allowed: 'This resource is a plain counter and takes no item.',
  format_adjust_attr_missing: 'An added entry lacks an attribute that a step of an action over this list needs.',
  format_adjust_insufficient_holding: 'The player does not hold that many of this item, so they cannot be taken away.',
  format_adjust_domain_too_large: 'The list would have more entries than a list may have.',
  format_adjust_amendment_limit: 'This league has reached the number of list changes it allows.',
  format_adjust_relation_has_links: 'This relation already has links, and existing links cannot be changed.',
  format_adjust_action_unchanged: 'The action is already in that state, so nothing was changed.',
  format_adjust_domain_in_use:
    'This list change is refused: a player already holds an entry it removes, or a stage that counts this list has already started.',
  format_check_not_found: 'This check does not exist in this league.',
  format_check_not_open: 'This check has already been resolved.',
  format_request_too_large: 'This request is too large.',

  // League trash (src/lib/league-trash/errors.ts): the signals of league_trash_delete / league_trash_restore, the
  // restore of a league whose delete rebuild is still pending, and the junction blocks. The internal inventory
  // codes carry no table names (the details stay in the server log).
  LEAGUE_TRASH_NOT_FOUND: 'This league is not in the trash (it was already restored or removed).',
  LEAGUE_TRASH_EXPIRED: 'The restore window of this league has ended, so it can no longer be restored.',
  LEAGUE_TRASH_SEASON_EXISTS: 'A league with the same id exists again, so the trashed league cannot be restored. Nothing was restored.',
  LEAGUE_TRASH_SCHEMA_DRIFT:
    'The league cannot be restored: the table {rel} changed after the league was deleted and now needs the columns {columns}, which the saved copy does not have. Nothing was restored.',
  LEAGUE_TRASH_PARENT_MISSING:
    'The league cannot be restored: its records in {rel} (column {column}) point to a {parent} that was deleted in the meantime. Nothing was restored.',
  LEAGUE_TRASH_PLAN_MISMATCH:
    'The saved copy of this league could not be restored completely, so nothing was restored. The details are in the server log.',
  LEAGUE_TRASH_INVENTORY_INCOMPLETE:
    'The league cannot be moved to the trash because the database has tables the trash does not know yet. Nothing was changed. The details are in the server log.',
  LEAGUE_TRASH_INVENTORY_STALE:
    'The league cannot be moved to the trash because the trash lists tables the database no longer has. Nothing was changed. The details are in the server log.',
  LEAGUE_TRASH_BUSY: 'Another change to this league is running. Try again in a moment.',
  LEAGUE_TRASH_TIMEOUT:
    'The request took too long, so the result is unknown. Reload the page to see whether it went through.',
  LEAGUE_TRASH_REBUILD_PENDING:
    'The statistics and ratings of this deleted league were not rebuilt yet. Run the pending rebuild first, then restore the league.',

  // Substitution in a league with a custom format: the substitute inherits the seat's format data (docs/format-kit.md, "Substitution").
  format_substitute_links_collide:
    "The incoming player already has a link in this format that would collide with the outgoing player's, so the format data cannot move. Nothing was changed.",
  format_substitute_items_collide:
    "The incoming player already holds items of a resource whose limit the outgoing player's items would exceed, so the format data cannot move. Nothing was changed.",
  format_substitute_submissions_collide:
    'The incoming player has already picked for an action the outgoing player picked for (or the two picked for each other), so the format data cannot move. Nothing was changed.',
  format_substitute_attrs_collide:
    'The incoming player already has a format attribute the outgoing player also has, so the format data cannot move. Nothing was changed.',
  format_substitute_tracks_collide:
    'The incoming player already has progress on a track the outgoing player also has, so the format data cannot move. Nothing was changed.',
  format_substitute_challenges_collide:
    "The incoming player already has an open challenge that would collide with one of the outgoing player's, so the format data cannot move. Nothing was changed.",
  substitute_format_seat_kept:
    'The outgoing player stays in {phases}, so their format data (links, items, picks, attributes, progress) stays with them. It moves when they are substituted out of the last of these phases.',

  // Roster changes of a started format phase are forced with a reason (docs/format-kit.md, "Roster changes after the start").
  PHASE_ROSTER_REASON_REQUIRED: 'Forcing a roster change on a started phase of the format needs a reason of 1 to 500 characters.',
} as const;
