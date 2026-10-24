/**
 * Error catalog `errors/draft`. Keys are the UPPER_SNAKE draft codes; the English
 * text here is the only English source (`draftErrorMessage`,
 * `src/lib/draft/errors.ts`). Placeholders are the response `params`; machine
 * data that is never rendered travels in `detail`.
 *
 * The first block is G0-ERR's seed (codes the legacy engine
 * `src/lib/draft/engine.ts` returns; B-HOT's temporary `BRANCH_PAIR_UNSUPPORTED`
 * is retired now that legacy trackers carry a line id), kept verbatim except NOT_YOUR_TURN,
 * DRAFT_COMPLETE and INSUFFICIENT_BUDGET, which use the second-person §9.1
 * text (the engine keeps its own English `message`). HTTP statuses live in
 * `DRAFT_ERROR_STATUS` (`src/lib/draft/errors.ts`).
 */
export default {
  // G0-ERR seed (NOT_YOUR_TURN, DRAFT_COMPLETE and INSUFFICIENT_BUDGET in the §9.1 second-person wording)
  POOL_NOT_ACTIVE: 'Draft is not currently active',
  DRAFT_COMPLETE: 'The draft is complete.',
  NOT_YOUR_TURN: 'It is not your turn.',
  POKEMON_TAKEN: '{pokemon} has already been drafted',
  INSUFFICIENT_BUDGET: 'Insufficient budget: this line costs {price} P, you have {remaining} P.',
  LINE_TAKEN: 'This line was just drafted.',

  // §9.1 queue engine, redraft and tokens
  POOL_NOT_FOUND: 'Draft not found.',
  POOL_ENGINE_LEGACY: 'This draft uses the old engine.',
  POOL_ENGINE_LEGACY_EPB:
    'Point-buy leagues draft only with the current draft engine, so this old draft cannot start or take picks. If no teams were drafted from it and no redraft is attached, a league admin can set it back to pending, delete it and create a new one. Deleting it also deletes any picks it holds.',
  LIST_NOT_FOUND: 'Point-buy list not found.',
  ACTOR_NOT_ALLOWED: 'You can only act for yourself.',
  OVERRIDE_REASON_REQUIRED: 'A reason is required for an admin override.',
  DRAFT_NOT_ACTIVE: 'The draft is not running.',
  DRAFT_NOT_STARTED: 'The draft has not started yet.',
  DRAFT_ALREADY_STARTED: 'This setting cannot change after the draft has started.',
  SUBMISSION_PHASE: 'The redraft is still in its submission phase.',
  DRAFT_PAUSED: 'The draft is paused.',
  ALREADY_PAUSED: 'The draft is already paused.',
  NOT_PAUSED: 'The draft is not paused.',
  BLOCKED_SLOT_UNRESOLVED: 'Resolve the blocked pick before resuming.',
  STALE_SLOT: 'This pick is no longer on the clock.',
  NOT_PARTICIPANT: 'You are not part of this draft.',
  SLOT_BLOCKED: 'This pick is blocked and waits for an admin.',
  SLOT_NOT_BLOCKED: 'This pick is not blocked.',
  NOT_IN_LIST: "This line is not in the league's point-buy list.",
  OWN_REDRAFT_DROP: 'You dropped this line in this redraft and cannot pick it again.',
  LINE_RESTRICTED: 'This line is restricted for you.',
  COSMOG_REDRAFT_LOCKED: 'This line cannot be redrafted.',
  ROSTER_FULL: 'Your roster is full ({size} lines).',
  BUDGET_INFEASIBLE:
    'Not draftable – after this pick you would be at least {shortfall} points short of filling your last {slots} roster slots.',
  NOT_ENOUGH_LINES: 'Not draftable – only {available} lines are left for your last {slots} roster slots.',
  /** Pool gate (pick, void, restore): afterwards some participant could no longer fill their roster. Machine data in `detail`. */
  POOL_NOT_COMPLETABLE: 'Not possible – afterwards not every player could still fill their roster within their budget.',
  /** Pool gate search reached its step cap: only a proven completion is accepted. */
  POOL_CHECK_LIMIT: 'This could not be checked against every roster in time, so it was not applied. Choose another line or ask an admin.',
  /**
   * draft_start: the league (or the league group) as configured can never fill every roster; `{slots}` = all roster
   * slots. Too many trainers for one list is the usual cause: the copy points the admin at league groups.
   */
  LEAGUE_NOT_COMPLETABLE:
    'The draft cannot start: the {lines} lines of the list cannot fill all {slots} roster slots of the {participants} players within their budgets. Split the participants into smaller groups on the Participants tab, so each group drafts its own pool.',
  /** Redraft publish: the published redraft could never fill every redraft slot; the publish is rolled back. */
  REDRAFT_NOT_COMPLETABLE:
    'The redraft cannot be published: the {lines} free lines cannot fill all {slots} redraft slots within the budgets. Move the submission deadline so players can change their drops.',
  /** draft_end on a running redraft: published drops already left the rosters. */
  DRAFT_ABORT_NOT_ALLOWED: 'A running redraft cannot be aborted. Pause it and correct picks or restore drops instead.',
  REDRAFT_SLOT_REQUIRED: 'Choose which redraft slot this pick fills.',
  REDRAFT_SLOT_INVALID: 'That redraft slot is not yours.',
  REDRAFT_SLOT_FILLED: 'That redraft slot is already filled.',
  REQUEST_ID_REUSED: 'This request id was already used for a different pick.',
  EXTENSION_NOT_ALLOWED: 'Time extensions are not available in this draft.',
  EXTENSION_USED: 'You already used this extension.',
  PICK_NOT_FOUND: 'Pick not found.',
  PICK_ALREADY_VOIDED: 'This pick was already voided.',
  CORRECTION_REQUIRES_PAUSE: 'Pause the draft before correcting picks.',
  VOID_BLOCKED_PROGRESS: 'This line already has {progress} evolution progress; correct the progress instead.',
  USE_VOID_PICK: 'Use "void pick" for this draft.',
  SUBMISSION_LOCKED: 'Redraft submission is locked after the deadline.',
  REDRAFT_MAX_EXCEEDED: 'You can drop at most {max} lines.',
  /** Admin lowers redraft_max_lines below a saved submission; `{count}` = the largest saved drop list. */
  REDRAFT_MAX_BELOW_SUBMISSIONS: 'A player already chose {count} lines to drop. The maximum cannot be lower than that.',
  TRACKER_NOT_OWNED: 'This line is not on your roster.',
  /** Admin progress correction for a line the player does not hold; `{pokemon}` = the line's English base name (pkmn layer). */
  TRACKER_NOT_FOUND: 'No tracker found for {pokemon}',
  LINE_NOT_DROPPABLE: 'This line cannot be dropped in the redraft.',
  SUBMISSIONS_NOT_DUE: 'Submissions can be published at the deadline.',
  SUBMISSIONS_ALREADY_PUBLISHED: 'Submissions are already published.',
  REDRAFT_NOT_YET_ALLOWED: 'The first half is not complete yet.',
  INITIAL_DRAFT_NOT_COMPLETE: 'The initial draft is not complete.',
  RESTORE_WOULD_OVERDRAW: "Restoring this drop would overdraw the player's budget.",
  POOL_EXISTS: 'A draft of this kind already exists for this season.',
  /** DELETE of a queue pool outside phase setup/cancelled; the phase travels in `detail`. */
  POOL_NOT_DELETABLE: 'This draft can only be deleted before it starts or after it is cancelled. Cancel it first.',
  /** DELETE of a pool that a redraft pool still points at (FK parent_pool_id, SQLSTATE 23503). */
  POOL_HAS_REDRAFT: 'This draft has a redraft attached. Delete the redraft first.',
  /** DELETE of a pool that teams were drafted from (FK fk_teams_draft_pool, SQLSTATE 23503). */
  POOL_HAS_TEAMS: 'Teams were drafted from this draft, so it cannot be deleted. It stays as the record of those teams.',
  SEASON_HAS_NO_LIST: 'This league has no bound point-buy list.',
  /** League groups (20261018180000): a league with groups drafts per group. */
  SEASON_GROUP_REQUIRED: 'This league has groups: create the draft for one of its groups.',
  SEASON_GROUP_INVALID: 'This group does not belong to this league.',
  SEASON_GROUP_LOCKED: 'The groups cannot change while a group has a draft. Cancel and delete that draft first.',
  SEASON_GROUPS_AFTER_DRAFT:
    'This league already drafted without groups. Groups can only be set up before the first draft.',
  SEASON_GROUP_MEMBERS_INVALID: 'Every group member must be a participant of this league, in exactly one group.',
  SEASON_GROUP_IN_USE: 'A draft, a phase or drafted lines still use this group, so it cannot be removed.',
  /** League groups (20261018202000): membership is frozen once a phase has rounds. */
  SEASON_GROUPS_SCHEDULED:
    'This league already has rounds, so its groups can no longer change: the schedule, the group tables and the draft order use them. Renaming a group stays possible.',
  SEASON_GROUP_TOO_SMALL: 'Every group needs at least two trainers.',
  SEASON_GROUP_SUBSTITUTION_LOCKED:
    'This trainer’s group has a draft under way (Redraft submissions or picks), so the trainer cannot be substituted until that draft is complete or cancelled.',
  /** A group pool going live whose seats are not exactly the group's members (20261018202000, trigger on draft_pools). */
  SEASON_GROUP_SEATS_STALE:
    'This group’s trainers changed since the draft was set up, so its seats no longer match the group. Re-seat the draft from the group’s trainers, or delete it and create it again.',
  SEATS_INVALID: 'The draft order is invalid.',
  INVALID_CONFIG: 'Invalid setting: {field}.',
  TOKEN_WINDOW_CLOSED: 'Draft Kill Tokens cannot be bought now.',
  TOKEN_PLAYER_LIMIT: 'You already own the maximum of {max} Draft Kill Tokens.',
  TOKEN_LINE_LIMIT: 'This line already has a Draft Kill Token.',
  TOKEN_POINTS_SHORT: 'You need {needed} unspent points ({remaining} left).',
  TOKEN_WOULD_EVOLVE: 'A Draft Kill Token cannot trigger an evolution (progress {progress}, next at {next}).',
  LINE_FULLY_EVOLVED: 'This line is fully evolved.',
  COMEBACK_NOT_YET: 'Comeback Tokens can be spent after the Redraft.',
  COMEBACK_BALANCE_SHORT: 'You have only {balance} Comeback Tokens.',
  COMEBACK_TOKENS_NOT_MULTIPLE: 'On this line, Comeback Tokens are spent in steps of {ratio} (1 progress each).',
  FAVORITES_LIMIT: 'You can keep at most {max} favourites.',
  ENDPOINT_REPLACED: 'This endpoint was replaced.',
  REDRAFT_TRADE_RETIRED: 'Trades were retired. Lines change hands only through the secret-drop redraft.',

  // §9.2 legacy api/drafts/** branches (English = the routes' existing text)
  POINT_BUDGET_REQUIRED: 'point_budget is required for auction/budget drafts',
  NOT_IN_POOL: '{pokemon} is not in the draft pool',
  TIER_LIMIT_REACHED: '{tier}-tier limit reached (max {max})',
  PICK_CAP_REACHED: 'Draft pick cap reached ({max} evolution lines per trainer)',
  POINTS_CAP_EXCEEDED: 'Not enough points. Would spend {spend}/{budget} ({price} for this line)',
  REPLAY_PICK_EVENTS_AUTO: 'Pick events are auto-generated. Use POST /api/drafts/[id]/picks instead.',
  INVALID_INCLUDE: 'include must be one of: {allowed}',
  UNDO_NOT_ACTIVE: 'Can only undo picks in an active draft',
  INVALID_PICK_ID: 'Pick not found',
  INVALID_REDRAFT_SLOT_ID: 'Redraft slot not found',
} as const;
