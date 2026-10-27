/** Explicit column lists (AGENTS: no `select('*')`). Proposals never select the token hash or the approval fingerprint. */

export const CONVERSATION_COLUMNS =
  'id, admin_id, admin_name, title, status, ui_locale, context, model, effort, tool_set, tool_registry_version, system_prompt_version, active_plan_id, seq_head, turn_lease_until, version, blast_league_creates, blast_tournament_creates, blast_ruleset_creates, blast_format_creates, blast_golive_executions, blast_pin_targets, last_message_at, created_at, updated_at';

export const MESSAGE_COLUMNS =
  'conversation_id, seq, role, kind, content, content_purged_at, ui, model, stop_reason, usage, client_msg_id, created_at';

export const PLAN_COLUMNS =
  'id, conversation_id, admin_id, admin_name, mode, status, revision, doc, doc_hash, build_started_at, build_finished_at, created_at, updated_at';

export const PLAN_REVISION_COLUMNS = 'plan_id, revision, doc, patch, author, created_at';

export const PROPOSAL_SUMMARY_COLUMNS =
  'id, conversation_id, admin_id, admin_name, kind, class, plan_id, plan_revision, status, tool_registry_version, proposal_hash, preview, preview_hash, acks_required, expires_at, executing_started_at, finished_at, approved_by, approved_at, supersede_key, locale, created_at';

/** The summary columns plus `steps`. */
export const PROPOSAL_COLUMNS =
  'id, conversation_id, admin_id, admin_name, kind, class, plan_id, plan_revision, status, tool_registry_version, steps, proposal_hash, preview, preview_hash, acks_required, expires_at, executing_started_at, finished_at, approved_by, approved_at, supersede_key, locale, created_at';

export const ACTION_COLUMNS =
  'id, conversation_id, admin_id, admin_name, created_at, tool_use_id, tool_name, class, proposal_id, step_key, method, path, args, args_hash, status, http_status, outcome_kind, error_code, result, before, after, after_fingerprint, undo, reversibility, verify, entity_type, entity_id';

export const REF_COLUMNS = 'conversation_id, ref_kind, ref_id, label, source, seen_at';

export const SNAPSHOT_COLUMNS = 'id, action_id, document, doc_hash, expires_at, created_at';
