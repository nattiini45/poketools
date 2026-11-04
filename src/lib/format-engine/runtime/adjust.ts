/**
 * Manual adjustments by an admin (`adjust.manual`). Each is one `format_apply_adjustment` call: the audit row (kind,
 * target, delta, the required reason, the admin) and the ops it implies commit together. What a kind does:
 *
 * - `points`: the row itself is the effect (the standings sum the `points` rows of a stage); no ops, or the points would count twice;
 * - `rank`: the row holds the admin's order of a stage (the latest wins, `rank.manual` reads it); no ops;
 * - `resource`: a positive `amount` grants, a negative one revokes (`grant_item` / `revoke_item`);
 * - `relation`: `reveal` reveals the relation, `links` sets them while the relation has none (an existing link is never
 *   changed: the op vocabulary has no per-link edit); the row alone is recorded otherwise;
 * - `action`: opens or locks the action by hand;
 * - `domain`: an amendment (`{ domain, add?, remove? }`) appended to the format's amendments; refused while an action
 *   that uses the domain is locked (`domain_amendment_locked`);
 * - `outcome`: recorded only. The match result itself changes through the match result route.
 *
 * Server only.
 */
import 'server-only';

import { expireSeasonReads } from '@/lib/revalidation';
import { applyFormatAdjustment, FormatRuntimeError, type FormatAdjustmentKind } from '@/lib/supabase/queries/format-runtime';
import type { DomainEntry, RuleEntry } from '@/lib/format-kit/types';
import type { Json } from '@/types/database';
import { loadFreshKitContext, rosterOf, type KitContext } from './load';
import type { FormatOp } from './types';

export type AdjustmentInput =
  | { kind: 'points'; stage: string; playerId: string; points: number }
  | { kind: 'rank'; stage: string; order: readonly string[] }
  | { kind: 'resource'; resource: string; playerId: string; itemId?: string | null; amount: number }
  | { kind: 'relation'; relation: string; reveal?: boolean; links?: readonly { from: string; to: string }[] }
  | { kind: 'action'; action: string; state: 'open' | 'locked' }
  | { kind: 'domain'; domain: string; add?: readonly DomainEntry[]; remove?: readonly string[] }
  | { kind: 'outcome'; matchId: string };

export interface AdjustmentRequest {
  seasonId: string;
  adminId: string | null;
  reason: string;
  adjustment: AdjustmentInput;
}

export type AdjustIssue = 'format_not_running' | 'adjust_not_allowed' | 'unknown_target' | 'invalid_amount';

export type AdjustResult = { ok: true; id: string } | { ok: false; issue: AdjustIssue };

interface Prepared {
  target: Json;
  delta: Json;
  ops: FormatOp[];
  guardActions: string[];
}

/** The adjustments are authorised by the format: some `adjust.manual` rule must allow the kind. */
function isAllowed(rules: readonly RuleEntry[], kind: FormatAdjustmentKind): boolean {
  return rules.some((rule) => rule.kind === 'adjust.manual' && rule.allow.includes(kind));
}

export async function applyAdjustment(request: AdjustmentRequest): Promise<AdjustResult> {
  const reason = request.reason.trim();
  if (reason === '') throw new FormatRuntimeError('reason_required');
  const ctx = await loadFreshKitContext(request.seasonId);
  if (ctx === null) return { ok: false, issue: 'format_not_running' };
  const { adjustment } = request;
  if (!isAllowed(ctx.def.rules, adjustment.kind)) return { ok: false, issue: 'adjust_not_allowed' };

  const prepared = prepare(ctx, adjustment);
  if (typeof prepared === 'string') return { ok: false, issue: prepared };

  const id = await applyFormatAdjustment({
    seasonId: request.seasonId,
    kind: adjustment.kind,
    target: prepared.target,
    delta: prepared.delta,
    reason,
    adminId: request.adminId,
    ops: prepared.ops,
    guardActions: prepared.guardActions,
  });
  expireSeasonReads(request.seasonId, ctx.phases.map((phase) => phase.id));
  return { ok: true, id };
}

function prepare(ctx: KitContext, adjustment: AdjustmentInput): Prepared | AdjustIssue {
  const { def } = ctx;
  switch (adjustment.kind) {
    case 'points': {
      if (!Number.isFinite(adjustment.points) || adjustment.points === 0) return 'invalid_amount';
      if (!rosterOf(ctx, adjustment.stage).includes(adjustment.playerId)) return 'unknown_target';
      return {
        target: { stage: adjustment.stage, player_id: adjustment.playerId },
        delta: { points: adjustment.points },
        ops: [],
        guardActions: [],
      };
    }
    case 'rank': {
      const roster = new Set(rosterOf(ctx, adjustment.stage));
      if (roster.size === 0 || adjustment.order.some((id) => !roster.has(id))) return 'unknown_target';
      return { target: { stage: adjustment.stage }, delta: { order: [...adjustment.order] }, ops: [], guardActions: [] };
    }
    case 'resource': {
      const resource = (def.resources ?? []).find((r) => r.key === adjustment.resource);
      if (resource === undefined || !rosterOf(ctx).includes(adjustment.playerId)) return 'unknown_target';
      if (!Number.isInteger(adjustment.amount) || adjustment.amount === 0) return 'invalid_amount';
      const item = resource.holds.kind === 'domain' ? (adjustment.itemId ?? null) : null;
      if (resource.holds.kind === 'domain' && item === null) return 'unknown_target';
      const op: FormatOp =
        adjustment.amount > 0
          ? {
              op: 'grant_item',
              resource: resource.key,
              player_id: adjustment.playerId,
              item_id: item,
              amount: adjustment.amount,
              exclusive: resource.exclusive === 'global' && item !== null,
              source: 'adjustment',
              source_ref: null,
            }
          : { op: 'revoke_item', resource: resource.key, player_id: adjustment.playerId, item_id: item, amount: -adjustment.amount };
      return {
        target: { resource: resource.key, player_id: adjustment.playerId, item_id: item },
        delta: { amount: adjustment.amount },
        ops: [op],
        guardActions: [],
      };
    }
    case 'relation': {
      if (!(def.relations ?? []).some((r) => r.key === adjustment.relation)) return 'unknown_target';
      const ops: FormatOp[] = [];
      if (adjustment.links !== undefined) ops.push({ op: 'set_relation', relation: adjustment.relation, links: adjustment.links.map((l) => ({ ...l })) });
      if (adjustment.reveal === true) ops.push({ op: 'reveal_relation', relation: adjustment.relation });
      return {
        target: { relation: adjustment.relation },
        delta: {
          ...(adjustment.reveal === true ? { reveal: true } : {}),
          ...(adjustment.links !== undefined ? { links: adjustment.links.map((l) => ({ ...l })) } : {}),
        },
        ops,
        guardActions: [],
      };
    }
    case 'action': {
      const rule = def.rules.find((r) => r.kind === 'player.action' && r.id === adjustment.action);
      if (rule === undefined) return 'unknown_target';
      return {
        target: { action: adjustment.action },
        delta: { state: adjustment.state },
        ops: [adjustment.state === 'open' ? { op: 'open_action', action: adjustment.action } : { op: 'lock_action', action: adjustment.action }],
        guardActions: [],
      };
    }
    case 'domain': {
      if (!(def.domains ?? []).some((d) => d.key === adjustment.domain)) return 'unknown_target';
      const guardActions = def.rules.flatMap((r) => (r.kind === 'player.action' && r.steps.some((s) => s.domain === adjustment.domain) ? [r.id] : []));
      return {
        target: { domain: adjustment.domain },
        delta: {
          domain: adjustment.domain,
          ...(adjustment.add !== undefined ? { add: adjustment.add.map((e) => ({ id: e.id, attrs: e.attrs.map((a) => ({ key: a.key, value: a.value })) })) } : {}),
          ...(adjustment.remove !== undefined ? { remove: [...adjustment.remove] } : {}),
        },
        ops: [],
        guardActions,
      };
    }
    case 'outcome':
      return { target: { match_id: adjustment.matchId }, delta: {}, ops: [], guardActions: [] };
  }
}
