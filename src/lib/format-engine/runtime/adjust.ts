/**
 * Manual adjustments by an admin (`adjust.manual`). Each is one `format_apply_adjustment` call: the audit row (kind,
 * target, delta, the required reason, the admin) and the ops it implies commit together. What a kind does:
 *
 * - `points`: the row itself is the effect (the standings sum the `points` rows of a stage); no ops, or the points would count twice;
 *   at most 1000 in either direction with two decimals (the bound of the kit's own scoring values);
 * - `rank`: the row holds the admin's order of a stage (the latest wins, `rank.manual` reads it); no ops. The order must be
 *   a permutation of the stage roster (`invalid_order` otherwise): the standings take it as the whole order;
 * - `resource`: a positive `amount` grants, a negative one revokes (`grant_item` / `revoke_item`). A domain resource needs
 *   an `itemId` that is an entry of the domain as amended (`item_outside_domain`) and names one (`item_required`), a
 *   counter takes none (`item_not_allowed`); a revoke needs the units to be held (`insufficient_holding`: the ops would
 *   silently remove fewer and the row would then record a change that did not happen);
 * - `relation`: `reveal` reveals the relation, `links` sets them while the relation has none (an existing link is never
 *   changed: the op vocabulary has no per-link edit, so `links` on a relation that has links is refused as
 *   `relation_has_links` instead of being recorded as a change that never happened). The links must fit the roster and
 *   the relation's shape (`invalid_links`), which also keeps the table's keys and checks from surfacing as a 500.
 *   The two refusals that read state (`relation_has_links`, `insufficient_holding`) are decided twice: against the context
 *   loaded here, and again inside `format_apply_adjustment` under a lock, so a concurrent request cannot slip in between
 *   (the database raises, nothing is written, and the same issue comes back);
 *   `draw` sets the links from the season seed and the league roster instead (the draw of a secret santa); the seed never
 *   leaves the server. `draw` and `links` exclude each other. The row stores the number of links, never a pair;
 * - `action`: opens or locks the action by hand (a lock fires the action's `action_locked` event like any other lock; if
 *   that second step fails the adjustment stays and the cron pass fires the event). A state the action is already in
 *   (`lock` on a locked action, `open` on one whose window is open) is refused as `action_state_unchanged`, so the history
 *   never records a lock or an opening that did not happen. `open` flips the action's flag only: a submission that was
 *   already locked (by the lock, or on submit) stays locked;
 * - `domain`: an amendment (`{ domain, add?, remove? }`) appended to the format's amendments; refused while an action
 *   that uses the domain is locked (`domain_amendment_locked`; an action uses it as a step's domain or through a step's
 *   resource that holds it), when it removes an entry a player holds, and when a started stage counts the domain in a
 *   team constraint (`domain_in_use`). The amended domain holds at most `MAX_DOMAIN_ENTRIES` entries
 *   (`domain_too_large`), at most `FORMAT_MAX_DOMAIN_AMENDMENTS` amendments are stored (`amendment_limit`), and an added
 *   entry carries the attribute an action step over the domain asks to be distinct in (`attr_missing`);
 * - `outcome`: recorded only. The match result itself changes through the match result route.
 *
 * Server only.
 */
import 'server-only';

import { expireSeasonReads } from '@/lib/revalidation';
import {
  applyFormatAdjustment,
  FORMAT_ADJUSTMENT_REASON_MAX,
  FormatAdjustmentRefusedError,
  FormatRuntimeError,
  type FormatAdjustmentKind,
} from '@/lib/supabase/queries/format-runtime';
import { MAX_DOMAIN_ENTRIES } from '@/lib/format-kit/limits';
import type { CountSource, DomainEntry, RuleEntry, Stage } from '@/lib/format-kit/types';
import type { Json } from '@/types/database';
import { actionFlagKey, findAction, isActionWindowOpen } from './actions';
import { amendEntries, findDomainView } from './domains';
import { eventKey } from './events';
import { logger } from '@/lib/logger';
import { fireEvent } from './fire';
import { loadFreshKitContext, rosterOf, type KitContext } from './load';
import { generateRelationLinks, validateRelationLinks } from './relations';
import { own, type FormatOp } from './types';

/** The most domain amendments a league stores (`season_formats.amendments`, re-read on every context load). */
export const FORMAT_MAX_DOMAIN_AMENDMENTS = 64;

/** The largest `points` adjustment in either direction: the bound of the kit's own scoring values. */
const POINTS_ABS_MAX = 1000;

export type AdjustmentInput =
  | { kind: 'points'; stage: string; playerId: string; points: number }
  | { kind: 'rank'; stage: string; order: readonly string[] }
  | { kind: 'resource'; resource: string; playerId: string; itemId?: string | null; amount: number }
  | {
      kind: 'relation';
      relation: string;
      reveal?: boolean;
      links?: readonly { from: string; to: string }[];
      /** Draw the links from the season seed and the league roster; excludes `links`. */
      draw?: boolean;
    }
  | { kind: 'action'; action: string; state: 'open' | 'locked' }
  | { kind: 'domain'; domain: string; add?: readonly DomainEntry[]; remove?: readonly string[] }
  | { kind: 'outcome'; matchId: string };

export interface AdjustmentRequest {
  seasonId: string;
  adminId: string | null;
  reason: string;
  adjustment: AdjustmentInput;
}

export type AdjustIssue =
  | 'format_not_running'
  | 'adjust_not_allowed'
  | 'unknown_target'
  | 'invalid_amount'
  | 'relation_has_links'
  | 'action_state_unchanged'
  | 'domain_in_use'
  | 'invalid_links'
  | 'invalid_order'
  | 'item_required'
  | 'item_not_allowed'
  | 'item_outside_domain'
  | 'insufficient_holding'
  | 'domain_too_large'
  | 'amendment_limit'
  | 'attr_missing';

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
  // The table's check counts characters (code points), not UTF-16 units.
  if (Array.from(reason).length > FORMAT_ADJUSTMENT_REASON_MAX) throw new FormatRuntimeError('reason_too_long');
  const ctx = await loadFreshKitContext(request.seasonId);
  if (ctx === null) return { ok: false, issue: 'format_not_running' };
  const { adjustment } = request;
  if (!isAllowed(ctx.def.rules, adjustment.kind)) return { ok: false, issue: 'adjust_not_allowed' };

  const prepared = prepare(ctx, adjustment);
  if (typeof prepared === 'string') return { ok: false, issue: prepared };

  let id: string;
  try {
    id = await applyFormatAdjustment({
      seasonId: request.seasonId,
      kind: adjustment.kind,
      target: prepared.target,
      delta: prepared.delta,
      reason,
      adminId: request.adminId,
      ops: prepared.ops,
      guardActions: prepared.guardActions,
    });
  } catch (error) {
    // The database repeats the two checks that read state (links of a relation, units held) under a lock: a concurrent
    // adjustment can change them between the read above and this write. Nothing was written; answer like the check above.
    if (error instanceof FormatAdjustmentRefusedError) {
      expireSeasonReads(request.seasonId, ctx.phases.map((phase) => phase.id));
      return { ok: false, issue: error.refusal };
    }
    throw error;
  }
  expireSeasonReads(request.seasonId, ctx.phases.map((phase) => phase.id));
  if (adjustment.kind === 'action' && adjustment.state === 'locked') {
    try {
      await fireEvent(request.seasonId, { event: 'action_locked', action: adjustment.action }, request.adminId);
    } catch (error) {
      logger.error('format-engine/adjust', 'action_locked after a manual lock failed; the cron pass retries it', {
        seasonId: request.seasonId,
        action: adjustment.action,
        error,
      });
    }
  }
  return { ok: true, id };
}

function countsDomain(source: CountSource, domain: string): boolean {
  switch (source.kind) {
    case 'domain':
      return source.domain === domain;
    case 'resource':
    case 'species':
      return false;
    case 'any_of':
      return source.sources.some((inner) => countsDomain(inner, domain));
    case 'not':
      return countsDomain(source.source, domain);
  }
}

const stageCountsDomain = (stage: Stage, domain: string): boolean =>
  (stage.constraints ?? []).some((c) => c.kind === 'count' && countsDomain(c.source, domain));

/**
 * Whether an amendment of `domain` would change something that already happened: an entry a player holds is removed
 * (through a resource that holds the domain), or a stage that counts the domain in a team constraint has started
 * (its `stage_start` fired), so teams were already checked against the old list.
 */
function domainInUse(ctx: KitContext, domain: string, remove: readonly string[]): boolean {
  if (remove.length > 0) {
    const holding = new Set((ctx.def.resources ?? []).filter((r) => r.holds.kind === 'domain' && r.holds.domain === domain).map((r) => r.key));
    const gone = new Set(remove);
    if (ctx.state.items.some((item) => holding.has(item.resource) && item.item_id !== null && gone.has(item.item_id))) return true;
  }
  return ctx.def.stages.some((stage) => stageCountsDomain(stage, domain) && ctx.state.firedEventKeys.includes(eventKey({ event: 'stage_start', stage: stage.key })));
}

/** The most decimals of a `points` adjustment (the column is numeric; two are what the kit's scoring values allow). */
const hasAtMostTwoDecimals = (n: number): boolean => Math.round(n * 100) / 100 === n;

/** Whether an amendment adds an entry without the attribute an action step over the domain asks to be distinct in. */
function missesDistinctAttr(ctx: KitContext, domain: string, add: readonly DomainEntry[]): boolean {
  const wanted = ctx.def.rules.flatMap((rule) =>
    rule.kind === 'player.action'
      ? rule.steps.flatMap((step) => (step.domain === domain && step.distinct_attr !== undefined ? [step.distinct_attr] : []))
      : [],
  );
  return add.some((entry) => wanted.some((attr) => !entry.attrs.some((a) => a.key === attr)));
}

function prepare(ctx: KitContext, adjustment: AdjustmentInput): Prepared | AdjustIssue {
  const { def } = ctx;
  switch (adjustment.kind) {
    case 'points': {
      if (!Number.isFinite(adjustment.points) || adjustment.points === 0) return 'invalid_amount';
      if (Math.abs(adjustment.points) > POINTS_ABS_MAX || !hasAtMostTwoDecimals(adjustment.points)) return 'invalid_amount';
      if (!rosterOf(ctx, adjustment.stage).includes(adjustment.playerId)) return 'unknown_target';
      return {
        target: { stage: adjustment.stage, player_id: adjustment.playerId },
        delta: { points: adjustment.points },
        ops: [],
        guardActions: [],
      };
    }
    case 'rank': {
      const roster = rosterOf(ctx, adjustment.stage);
      if (roster.length === 0) return 'unknown_target';
      // The standings take the latest rank row as the whole order of the stage, so a partial or repeated order has no
      // meaning for the players it leaves out: it must be a permutation of the roster.
      const members = new Set(roster);
      const listed = new Set(adjustment.order);
      if (listed.size !== adjustment.order.length || listed.size !== members.size || adjustment.order.some((id) => !members.has(id))) {
        return 'invalid_order';
      }
      return { target: { stage: adjustment.stage }, delta: { order: [...adjustment.order] }, ops: [], guardActions: [] };
    }
    case 'resource': {
      const resource = (def.resources ?? []).find((r) => r.key === adjustment.resource);
      if (resource === undefined || !rosterOf(ctx).includes(adjustment.playerId)) return 'unknown_target';
      if (!Number.isInteger(adjustment.amount) || adjustment.amount === 0) return 'invalid_amount';
      // A counter holds no item and a domain resource always names one: two different mistakes, two issues.
      const item = adjustment.itemId ?? null;
      if (resource.holds.kind === 'domain' && item === null) return 'item_required';
      if (resource.holds.kind === 'counter' && item !== null) return 'item_not_allowed';
      if (adjustment.amount > 0 && resource.holds.kind === 'domain') {
        const view = findDomainView(def, resource.holds.domain, ctx.state.flags, ctx.state.amendments);
        if (view === null || !view.entries.some((entry) => entry.id === item)) return 'item_outside_domain';
      }
      if (adjustment.amount < 0) {
        // `revoke_item` removes fewer units than asked without complaint; the row must not claim more than happened.
        const held = ctx.state.items
          .filter((it) => it.resource === resource.key && it.player_id === adjustment.playerId && it.item_id === item)
          .reduce((sum, it) => sum + it.amount, 0);
        if (held < -adjustment.amount) return 'insufficient_holding';
      }
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
      const relation = (def.relations ?? []).find((r) => r.key === adjustment.relation);
      if (relation === undefined) return 'unknown_target';
      const draw = adjustment.draw === true;
      if (draw && adjustment.links !== undefined) return 'invalid_links';
      // Nothing to reveal, set or draw: the row would record a change that never happened.
      if (!draw && adjustment.links === undefined && adjustment.reveal !== true) return 'invalid_links';
      if ((draw || adjustment.links !== undefined) && ctx.state.links.some((l) => l.relation === adjustment.relation)) {
        return 'relation_has_links';
      }
      // A reveal on its own acts on links that exist and are still hidden: otherwise `reveal_relation` updates no row and the
      // history would claim a reveal that never happened.
      if (
        !draw &&
        adjustment.links === undefined &&
        !ctx.state.links.some((l) => l.relation === adjustment.relation && !l.revealed)
      ) {
        return 'invalid_links';
      }
      const roster = rosterOf(ctx);
      let links: { from: string; to: string }[] | undefined;
      if (draw) {
        if (roster.length < 2) return 'unknown_target';
        links = generateRelationLinks(relation, roster, ctx.seed);
        // A `manual` relation draws nothing: its links are set by hand.
        if (links.length === 0) return 'invalid_links';
      } else if (adjustment.links !== undefined) {
        // An empty list is no adjustment (the shared validator accepts it for a `manual` relation): the row would record a
        // change that never happened.
        if (adjustment.links.length === 0 || !validateRelationLinks(relation.shape, roster, adjustment.links)) return 'invalid_links';
        links = adjustment.links.map((l) => ({ from: l.from, to: l.to }));
      }
      const ops: FormatOp[] = [];
      if (links !== undefined) ops.push({ op: 'set_relation', relation: adjustment.relation, links });
      if (adjustment.reveal === true) ops.push({ op: 'reveal_relation', relation: adjustment.relation });
      return {
        target: { relation: adjustment.relation },
        // The pairs live in the relation's own table; the history row (a player-facing read may list it) keeps the count.
        delta: {
          ...(adjustment.reveal === true ? { reveal: true } : {}),
          ...(links !== undefined ? { link_count: links.length, ...(draw ? { draw: true } : {}) } : {}),
        },
        ops,
        guardActions: [],
      };
    }
    case 'action': {
      const rule = findAction(def, adjustment.action);
      if (rule === null) return 'unknown_target';
      // The action is already in the requested state: the flag write would change nothing, and the row (and the audit
      // entry) would claim a lock or an opening that did not happen.
      const already =
        adjustment.state === 'locked' ? own(ctx.state.flags, actionFlagKey(rule.id)) === 'locked' : isActionWindowOpen(rule, ctx.state);
      if (already) return 'action_state_unchanged';
      return {
        target: { action: adjustment.action },
        delta: { state: adjustment.state },
        ops: [adjustment.state === 'open' ? { op: 'open_action', action: adjustment.action } : { op: 'lock_action', action: adjustment.action }],
        guardActions: [],
      };
    }
    case 'domain': {
      const domain = (def.domains ?? []).find((d) => d.key === adjustment.domain);
      if (domain === undefined) return 'unknown_target';
      if (domainInUse(ctx, adjustment.domain, adjustment.remove ?? [])) return 'domain_in_use';
      if (ctx.state.amendments.length >= FORMAT_MAX_DOMAIN_AMENDMENTS) return 'amendment_limit';
      if (adjustment.add !== undefined && missesDistinctAttr(ctx, adjustment.domain, adjustment.add)) return 'attr_missing';
      const after = amendEntries(domain.entries, domain.key, [
        ...ctx.state.amendments,
        {
          domain: domain.key,
          ...(adjustment.add !== undefined ? { add: [...adjustment.add] } : {}),
          ...(adjustment.remove !== undefined ? { remove: [...adjustment.remove] } : {}),
        },
      ]);
      if (after.length > MAX_DOMAIN_ENTRIES) return 'domain_too_large';
      // An action uses a domain through a step's list and through the resource a step grants (the resource holds it).
      const holding = new Set((def.resources ?? []).filter((r) => r.holds.kind === 'domain' && r.holds.domain === adjustment.domain).map((r) => r.key));
      const guardActions = def.rules.flatMap((r) =>
        r.kind === 'player.action' && r.steps.some((s) => s.domain === adjustment.domain || holding.has(s.resource)) ? [r.id] : [],
      );
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
