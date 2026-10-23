import { NextResponse } from 'next/server';
import { requireDraftAdmin } from '@/lib/auth/helpers';
import { DraftRuleError } from '@/lib/draft/errors';
import { draftErrorResponse } from '@/lib/draft/http';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { draftConfigPatchSchema, invalidDraftConfigField, type DraftConfigCore } from '@/lib/draft/schemas';
import { epbPack } from '@/lib/format-pack';
import { expireDraftReads } from '@/lib/revalidation';
import { getQueuePool } from '@/lib/supabase/queries/drafts-queue';
import { getSeasonGroupMemberIds } from '@/lib/supabase/queries/season-groups';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import type { ApiResult } from '@/types/api';
import type { DraftPool } from '@/types/draft';
import { DEFAULT_DRAFT_CONFIG, type DraftConfigInput } from '@/types/draft-queue';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Fallback budget/roster when a column is null (redraft pools have no budget of their own; format pack). */
const EPB_DEFAULT_BUDGET = epbPack.defaults.draftBudget;
const EPB_DEFAULT_ROSTER = epbPack.defaults.draftPicks;

const CORE_KEYS: readonly (keyof DraftConfigCore)[] = [
  'mode',
  'roster_size',
  'budget',
  'pick_seconds',
  'makeup_seconds',
  'slow_ladder_seconds',
  'redraft_max_lines',
];

/** The stored config fields that depend on each other, with the request applied on top. */
function mergedCore(pool: DraftPool, patch: DraftConfigInput): DraftConfigCore {
  return {
    mode: patch.mode ?? pool.mode ?? DEFAULT_DRAFT_CONFIG.mode,
    roster_size: patch.roster_size ?? pool.roster_size ?? EPB_DEFAULT_ROSTER,
    budget: patch.budget ?? pool.point_budget ?? EPB_DEFAULT_BUDGET,
    pick_seconds: patch.pick_seconds ?? pool.pick_seconds ?? DEFAULT_DRAFT_CONFIG.pick_seconds,
    makeup_seconds: patch.makeup_seconds ?? pool.makeup_seconds ?? DEFAULT_DRAFT_CONFIG.makeup_seconds,
    slow_ladder_seconds: patch.slow_ladder_seconds ?? pool.slow_ladder_seconds ?? [...DEFAULT_DRAFT_CONFIG.slow_ladder_seconds],
    redraft_max_lines:
      patch.redraft_max_lines !== undefined ? patch.redraft_max_lines : (pool.redraft_max_lines ?? null),
  };
}

/**
 * Seats from an admin-chosen order (seat 1 first). The order must be exactly
 * the pool's roster: the season's participants, or for a league group's pool the
 * group's members (`SEATS_INVALID` otherwise; zod already rejected repeats).
 * Only player ids are read.
 */
async function seatsFromOrder(pool: DraftPool, order: readonly string[]) {
  const participants = await getSeasonParticipants(pool.season_id);
  const groupMembers = pool.season_group_id ? await getSeasonGroupMemberIds(pool.season_group_id) : null;
  const ids = new Set(participants.map((p) => p.id).filter((id) => !groupMembers || groupMembers.has(id)));
  if (order.length !== ids.size || order.some((pid) => !ids.has(pid))) throw new DraftRuleError('SEATS_INVALID');
  return order.map((player_id, index) => ({ player_id, seat: index + 1 }));
}

/**
 * PATCH /api/drafts/[id]/config — change a queue pool's settings or seat order.
 *
 * Body: `DraftConfigInput` (every key optional, strict). The stored config is
 * merged with the request and checked as a whole (`INVALID_CONFIG {field}`),
 * because a PATCH may change `mode` without `pick_seconds`. Initial pools
 * accept changes only in setup (except `token_purchase_closes_at`); redraft
 * pools only in their submission phase. `draft_configure` logs
 * `draft_configured` / `seats_changed` with the previous and the new values.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireDraftAdmin(id);
    const body = draftConfigPatchSchema.parse(await request.json());

    const pool = await getQueuePool(id);
    if (CORE_KEYS.some((key) => body[key] !== undefined)) {
      const field = invalidDraftConfigField(mergedCore(pool, body));
      if (field) throw new DraftRuleError('INVALID_CONFIG', { field });
    }

    const { participant_order: order, ...patch } = body;
    const seats = order ? await seatsFromOrder(pool, order) : null;

    const result = await callDraftRpc<{ state_version: number }>('draft_configure', {
      p_pool_id: pool.id,
      p_actor_id: admin.playerId,
      p_patch: patch,
      p_seats: seats,
    });
    expireDraftReads(pool.season_id);

    return NextResponse.json<ApiResult<{ state_version: number }>>({
      success: true,
      data: { state_version: result.state_version },
    });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to update the draft settings');
  }
}
