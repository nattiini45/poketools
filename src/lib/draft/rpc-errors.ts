/**
 * Draft RPC glue (draft-backend §7.8; critique S5). Server only.
 *
 * Every queue-engine mutation and read is one plpgsql function (M5–M7). A rule
 * violation is a `RAISE EXCEPTION '<CODE>' USING ERRCODE = 'P0001', DETAIL =
 * <jsonb text>`; PostgREST hands it back as `{ code: 'P0001', message: '<CODE>',
 * details: '<json>' }`. `toDraftRuleError` turns that into a `DraftRuleError`:
 * the DETAIL keys that are placeholders of the English catalog message become
 * `params`, every other string/number key becomes `detail` (BR-17).
 *
 * The SQL-internal invariants (`INTERNAL_DRAFT_CODES`) and unknown messages are
 * NOT rule errors: they map to `null` and surface as a logged 500.
 */
import 'server-only';

import { supabase } from '@/lib/supabase/client';
import type { ApiErrorParams } from '@/i18n/messages/errors';
import type { Database } from '@/types/database';
import {
  DraftRuleError,
  INTERNAL_DRAFT_CODES,
  isDraftErrorCode,
  paramNamesOf,
  type DraftErrorCode,
} from '@/lib/draft/errors';

export type DraftRpcName =
  | 'draft_create_pool'
  | 'draft_configure'
  | 'draft_start'
  | 'draft_end'
  | 'draft_confirm_pick'
  | 'draft_use_extension'
  | 'draft_set_paused'
  | 'draft_admin_void_pick'
  | 'draft_admin_set_penalty'
  | 'draft_snapshot'
  | 'draft_my_turn'
  | 'draft_tick'
  | 'draft_claim_notifications'
  | 'redraft_set_submission'
  | 'redraft_publish'
  | 'redraft_admin_restore_drop'
  | 'epb_purchase_draft_token'
  | 'epb_spend_comeback_tokens'
  | 'epb_set_comeback_spend_open'
  | 'season_groups_replace'
  | 'season_participant_remove';

// Every name above must be a function of the generated schema (a typo fails tsc here).
type DbFunctionName = keyof Database['public']['Functions'];
const RPC_NAMES_EXIST: Record<DraftRpcName, DbFunctionName> = {
  draft_create_pool: 'draft_create_pool',
  draft_configure: 'draft_configure',
  draft_start: 'draft_start',
  draft_end: 'draft_end',
  draft_confirm_pick: 'draft_confirm_pick',
  draft_use_extension: 'draft_use_extension',
  draft_set_paused: 'draft_set_paused',
  draft_admin_void_pick: 'draft_admin_void_pick',
  draft_admin_set_penalty: 'draft_admin_set_penalty',
  draft_snapshot: 'draft_snapshot',
  draft_my_turn: 'draft_my_turn',
  draft_tick: 'draft_tick',
  draft_claim_notifications: 'draft_claim_notifications',
  redraft_set_submission: 'redraft_set_submission',
  redraft_publish: 'redraft_publish',
  redraft_admin_restore_drop: 'redraft_admin_restore_drop',
  epb_purchase_draft_token: 'epb_purchase_draft_token',
  epb_spend_comeback_tokens: 'epb_spend_comeback_tokens',
  epb_set_comeback_spend_open: 'epb_set_comeback_spend_open',
  season_groups_replace: 'season_groups_replace',
  season_participant_remove: 'season_participant_remove',
};
void RPC_NAMES_EXIST;

const INTERNAL: ReadonlySet<string> = new Set(INTERNAL_DRAFT_CODES);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** DETAIL text → object; anything that is not a JSON object yields `{}`. */
function parseDetails(details: unknown): Record<string, unknown> {
  if (isRecord(details)) return details;
  if (typeof details !== 'string' || details.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(details);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * PostgREST error `P0001` whose message is an `errors/draft` code → `DraftRuleError`;
 * anything else (other SQLSTATEs, internal codes, unknown messages, non-errors) → `null`.
 */
export function toDraftRuleError(err: unknown): DraftRuleError | null {
  if (err instanceof DraftRuleError) return err;
  if (!isRecord(err) || err.code !== 'P0001') return null;
  const message = typeof err.message === 'string' ? err.message.trim() : '';
  if (INTERNAL.has(message) || !isDraftErrorCode(message)) return null;
  const code: DraftErrorCode = message;

  const names = new Set(paramNamesOf(code));
  const params: Record<string, string | number> = {};
  const detail: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(parseDetails(err.details))) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    if (names.has(key)) params[key] = value;
    else detail[key] = value;
  }

  return new DraftRuleError(
    code,
    (Object.keys(params).length > 0 ? params : undefined) as ApiErrorParams<DraftErrorCode> | undefined,
    Object.keys(detail).length > 0 ? detail : undefined,
  );
}

type RpcResult = PromiseLike<{ data: unknown; error: unknown }>;
type UntypedRpc = (fn: DraftRpcName, args: Record<string, unknown>) => RpcResult;

/**
 * One draft RPC. A rule violation is thrown as `DraftRuleError`; every other
 * error is rethrown unchanged (a logged 500 through `safeErrorResponse`).
 * `T` is the caller's reading of the jsonb result; callers that need a checked
 * shape pass `unknown` and parse it.
 */
export async function callDraftRpc<T = unknown>(fn: DraftRpcName, args: Record<string, unknown>): Promise<T> {
  // The generated client types each function's args separately; the names are checked above.
  const rpc = supabase.rpc as unknown as UntypedRpc;
  const { data, error } = await rpc.call(supabase, fn, args);
  if (error) {
    const rule = toDraftRuleError(error);
    if (rule) throw rule;
    throw error;
  }
  return data as T;
}
