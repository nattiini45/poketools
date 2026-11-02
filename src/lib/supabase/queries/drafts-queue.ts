/**
 * Queue-engine draft RPCs used by the snapshot, pick, turn and extension routes. Each wrapper is exactly one
 * RPC (`callDraftRpc`: a rule violation becomes `DraftRuleError`) and reads the
 * jsonb result field by field.
 *
 * The snapshot read itself lives in `src/lib/draft/snapshot.ts` (`getDraftSnapshot`).
 */
import 'server-only';

import { DraftRuleError } from '@/lib/draft/errors';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { uuidSchema } from '@/lib/draft/schemas';
import type { EffectiveThresholds } from '@/lib/draft/line-catalog-data';
import type { DraftPool } from '@/types/draft';
import type { ActorRole, ExtensionKind, LineId } from '@/types/draft-queue';
import { getDraftPoolById } from './drafts';

/**
 * The pool of a queue-engine route (one read). Missing or not a uuid → `POOL_NOT_FOUND`;
 * a legacy pool → `POOL_ENGINE_LEGACY`, before any RPC runs.
 */
export async function getQueuePool(poolId: string): Promise<DraftPool> {
  if (!uuidSchema.safeParse(poolId).success) throw new DraftRuleError('POOL_NOT_FOUND');
  const pool = await getDraftPoolById(poolId);
  if (!pool) throw new DraftRuleError('POOL_NOT_FOUND');
  if (pool.engine !== 'queue') throw new DraftRuleError('POOL_ENGINE_LEGACY');
  return pool;
}

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export interface ConfirmPickArgs {
  poolId: string;
  slotId: string;
  /** The player whose slot is filled. */
  playerId: string;
  actorId: string;
  actorRole: Extract<ActorRole, 'player' | 'admin'>;
  lineId: LineId;
  clientRequestId: string;
  redraftSlotId?: string | null;
  /** Redraft pools only: override-aware cumulative thresholds of the picked line (§8.3 step 3). */
  lineThresholds?: EffectiveThresholds | null;
  overrideReason?: string | null;
}

/** `draft_confirm_pick` result (a replay omits `tracker_id`, `stage` and `next_slot_id`). */
export interface ConfirmPickResult {
  pick_id: string;
  line_id: LineId;
  pick_number: number;
  player_id: string;
  price: number;
  replay: boolean;
  /** Replays only: the earlier pick was voided since. */
  voided: boolean;
  completed: boolean;
  state_version: number;
  next_slot_id: string | null;
}

export async function confirmDraftPick(a: ConfirmPickArgs): Promise<ConfirmPickResult> {
  const raw = await callDraftRpc<unknown>('draft_confirm_pick', {
    p_pool_id: a.poolId,
    p_slot_id: a.slotId,
    p_player_id: a.playerId,
    p_actor_id: a.actorId,
    p_actor_role: a.actorRole,
    p_line_id: a.lineId,
    p_client_request_id: a.clientRequestId,
    p_redraft_slot_id: a.redraftSlotId ?? null,
    p_line_thresholds: a.lineThresholds ?? null,
    p_override_reason: a.overrideReason ?? null,
  });
  const r = rec(raw);
  return {
    pick_id: str(r.pick_id),
    line_id: str(r.line_id),
    pick_number: num(r.pick_number),
    player_id: str(r.player_id),
    price: num(r.price),
    replay: r.replay === true,
    voided: r.voided === true,
    completed: r.completed === true,
    state_version: num(r.state_version),
    next_slot_id: strOrNull(r.next_slot_id),
  };
}

/** `draft_use_extension` (live drafts; one +120 s and one +60 s per participant). */
export async function applyDraftExtension(a: {
  poolId: string;
  playerId: string;
  kind: ExtensionKind;
  slotId: string;
}): Promise<{ deadline_at: string; state_version: number }> {
  const raw = await callDraftRpc<unknown>('draft_use_extension', {
    p_pool_id: a.poolId,
    p_player_id: a.playerId,
    p_kind: a.kind,
    p_slot_id: a.slotId,
  });
  const r = rec(raw);
  return { deadline_at: str(r.deadline_at), state_version: num(r.state_version) };
}

/**
 * Queue pools with work due, earliest due first (the draft-ticks cron): an overdue slot in an unpaused draft, or a
 * Redraft past its submission deadline whose publish is not in backoff. The database decides, with the same predicate
 * `draft__tick` re-checks under the lock (`draft_list_due_pools`, 20261102150000), so idle pools are never ticked and
 * can never crowd a due pool out of the limit.
 */
export async function listTickablePools(limit: number): Promise<{ id: string; season_id: string }[]> {
  const rows = await callDraftRpc<unknown>('draft_list_due_pools', { p_limit: limit });
  if (rows === null || rows === undefined) return [];
  if (!Array.isArray(rows)) throw new Error('draft_list_due_pools returned a non-array');
  return rows.map((row: unknown) => {
    const { id, season_id: seasonId } = (row ?? {}) as { id?: unknown; season_id?: unknown };
    if (typeof id !== 'string' || typeof seasonId !== 'string') {
      throw new Error('draft_list_due_pools returned a row without id and season_id');
    }
    return { id, season_id: seasonId };
  });
}
