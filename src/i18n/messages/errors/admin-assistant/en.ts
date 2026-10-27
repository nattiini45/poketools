/**
 * Error catalog `errors/admin-assistant` (spec §18.14, plan 5.6): the Admin Assistant's own routes
 * (`/api/admin/agent/**`) and the harness behind them: kill switches, caps, the turn lease, the
 * confirmation protocol (proposals), typed outcomes and the preflight refusals.
 *
 * `en` is the English server message (templates as `{param}` placeholders); the server sends it as
 * `error` and adds the `code`, clients translate by `code`. The model never receives `err.message`,
 * only a code and its params. Shared failures use `errors/common` (`validation_failed`,
 * `invalid_json`, `forbidden`, `unauthenticated`, `rate_limited`, `rate_limit_unavailable`,
 * `upstream_timeout`), the ruleset and pin codes the harness meets are the existing
 * `RULESET_ERROR_CODES` (`errors/admin`, `errors/tournaments`), and a preflight cause that a route
 * already answers with its own code (`PHASE_NAME_TAKEN`, `SEASON_DATES_INVALID`,
 * `SEASON_GROUP_REQUIRED`, `format_not_attached`, ...) keeps that code and is not repeated here.
 *
 * Codes are flat snake_case and unique across all catalogs (`error-codes.test.ts`).
 */
export default {
  // Switches, audience and phase (a disabled assistant answers 404 and never says why)
  agent_disabled: 'The assistant is not available.',
  phase_disabled: 'This action is not enabled yet.',
  agent_golive_disabled: 'Going live through the assistant is switched off.',
  agent_config_invalid: 'The assistant is switched off until its configuration is fixed.',

  // Limits and budgets (all fail closed; amounts are shown by the page, not in these messages)
  agent_rate_limited: 'You are sending messages too fast. Try again in {seconds}s.',
  agent_conversation_busy: 'The assistant is still working on the previous message in this conversation.',
  agent_admin_busy: 'The assistant is still working on a message in another conversation.',
  agent_text_too_long: 'The message is too long. The limit is {max} characters.',
  agent_body_too_large: 'The request is too large.',
  agent_turn_limit_reached: 'The assistant stopped because this message reached its limit of steps. Ask it to continue.',
  agent_budget_exceeded: 'The assistant has reached its spending limit.',
  agent_budget_conversation: 'This conversation has reached its spending limit. Start a new conversation.',
  agent_budget_admin_day: 'You have reached your daily limit for the assistant. Try again tomorrow.',
  agent_budget_admin_month: 'You have reached your monthly limit for the assistant.',
  agent_budget_global_day: 'The assistant has reached its daily limit for all admins. Try again tomorrow.',
  agent_context_full: 'This conversation is too long to continue. Start a new conversation; the plan is carried over.',
  agent_cap_reached: 'This conversation has reached its limit of {limit} for this kind of change.',

  // Conversations, plans and tools
  conversation_not_found: 'Conversation not found.',
  plan_not_ready: 'The plan is not ready to build yet.',
  plan_stale: 'The plan changed since this was prepared. Review it again.',
  tool_not_available: 'The assistant cannot do this with your role.',
  unknown_reference: 'This refers to something the assistant has not looked up in this conversation.',
  text_not_allowed: 'This text contains characters or links that are not allowed.',

  // Proposals (the confirmation protocol)
  proposal_not_found: 'Proposal not found.',
  proposal_not_pending: 'This proposal was already handled.',
  proposal_expired: 'This proposal has expired. Ask the assistant to prepare it again.',
  proposal_token_invalid: 'This confirmation is no longer valid. Reload the card and try again.',
  proposal_hash_mismatch: 'The proposal changed after it was shown. Nothing was done; review the new card.',
  proposal_stale: 'Things changed since this was proposed. Nothing was done; ask the assistant to prepare it again.',
  proposal_forbidden: 'Your role no longer allows this proposal.',
  proposal_ack_missing: 'Tick every confirmation box first.',
  proposal_conflict_executing: 'Another proposal is still running in this conversation.',
  undo_unavailable: 'This cannot be undone.',

  // Execution outcomes
  step_failed: 'A step failed.',
  agent_build_step_failed: 'The build stopped at a step that failed. Earlier steps were kept.',
  unknown_outcome: 'It is not known whether this step went through. Check before trying again.',
  ledger_unavailable: 'Nothing was done because the assistant could not record it.',
  agent_harness_error: 'The assistant ran into an internal error. Nothing was retried.',

  // Preflight: causes that would otherwise be a masked server error or a silent no-op
  participant_already_enrolled: 'This player is already in the league.',
  player_not_eligible: 'This player cannot be added: the account is banned, suspended or a test account.',
  ruleset_unpublished: 'This ruleset has no published version yet. Publish it first.',
  ban_name_unresolved: 'Could not match {name} to a Pokémon, move, item or ability.',
  forme_expansion_needed: '{name} does not cover its other formes; ban each forme by name.',
  base_format_unknown: 'Unknown rule preset.',
  shared_type_pct_not_integer: 'The shared-type percentage must be a whole number.',
  bo_override_key_unknown: '{key} is not a round of this phase.',
  pool_entry_duplicate: '{name} is listed more than once in the pool.',
  tier_label_mismatch: 'The tier {label} does not match any tier of the list; labels are case-sensitive.',
  draft_not_supported_for_format: 'This league format cannot run a draft.',
  created_but_unadministrable: 'The tournament was created, but you were not made an admin of it. Ask a site admin.',
} as const;
