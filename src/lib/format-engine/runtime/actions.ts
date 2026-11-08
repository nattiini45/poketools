/**
 * Player actions (`player.action`): who may act, whether the window is open and whether a set of picks is allowed.
 * `validateActionSubmission` reports every problem it finds, not the first, so a form can mark each pick. It reads the
 * state it is given; the database re-checks the races a read cannot close and raises `action_locked` (a lock taken
 * meanwhile), `resource_item_taken` (an exclusive item taken meanwhile), `resource_capacity_reached` (the last free unit
 * of a capacity taken meanwhile by another grant) and `format_context_stale` (the format was replaced or amended after
 * the state was loaded) then.
 *
 * Window: the flag `action:<id>` is `"locked"` (closed), `"open"` (open) or absent, in which case the action is open
 * unless its window names an `opens_on` event that has not fired. An admin opens or locks by hand through the same flag.
 *
 * Audience: a player picks only from what they may see. `validateActionSubmission` takes `audience: 'player'` by default,
 * and then a step whose pool the player may not see (a domain with `visibility: 'admins'`, or a `when_unlocked` domain
 * that is still locked) is answered with `domain_locked` ALONE and no per-pick check at all: a pick is never told that
 * it is, or is not, a member of a hidden pool (`item_outside_domain`, `where_false`, `resource_item_taken` and the rest
 * would otherwise let a player probe the pool id by id). The system (the deadline pick of the cron, which draws from the
 * full list) passes `audience: 'system'` and gets the full per-pick checks.
 *
 * Who may act (`actorAccess`, the one rule the submit path, the cron's deadline pick and the player and admin views share):
 * an action `via` a relation needs the actor's link AND a place in the league (enrolled in a phase of the format); one
 * without `via` needs the roster. A player who is no longer in the league and still holds a link stops acting
 * (`actor_not_in_league`): their submissions are refused, the cron draws nothing for them, and what they already gave
 * stays. The recipient they leave is the admin's to handle. Pure and client-safe.
 */
import { evaluate } from '@/lib/format-kit/expr/eval';
import type { DomainEntry, FormatDefinition, PlayerActionRule } from '@/lib/format-kit/types';
import { toMap } from '@/lib/studio-core/keys';
import { findDomainView } from './domains';
import { entryContext, type EnvBase } from './expr-env';
import { own, type ActionPick, type KitRuntimeState } from './types';

export type ActionIssueCode =
  | 'format_not_running'
  | 'action_unknown'
  | 'window_closed'
  | 'actor_without_link'
  | 'actor_not_in_league'
  | 'step_unknown'
  | 'wrong_count'
  | 'resource_unknown'
  | 'domain_unknown'
  | 'domain_locked'
  | 'item_outside_domain'
  | 'where_false'
  | 'distinct_attr_duplicate'
  | 'duplicate_item'
  | 'capacity_exceeded'
  | 'resource_item_taken';

export interface ActionIssue {
  code: ActionIssueCode;
  step?: number;
  item_id?: string;
}

export interface ActionItemGrant {
  resource: string;
  item_id: string;
  exclusive: boolean;
}

export type ActionValidation =
  | { ok: true; target: string | null; items: ActionItemGrant[] }
  | { ok: false; issues: ActionIssue[] };

export const actionFlagKey = (action: string): string => `action:${action}`;

export function findAction(def: Pick<FormatDefinition, 'rules'>, id: string): PlayerActionRule | null {
  for (const rule of def.rules) if (rule.kind === 'player.action' && rule.id === id) return rule;
  return null;
}

export function isActionWindowOpen(rule: PlayerActionRule, state: Pick<KitRuntimeState, 'flags'>): boolean {
  const flag = own(state.flags, actionFlagKey(rule.id));
  if (flag === 'locked') return false;
  if (flag === 'open') return true;
  return rule.window.opens_on === undefined;
}

/** The target of `actorId`'s action: the `to` side of their link (`via`), null for a self action, or no access. */
export function resolveActionTarget(
  rule: PlayerActionRule,
  actorId: string,
  state: Pick<KitRuntimeState, 'links'>,
): { ok: true; target: string | null } | { ok: false } {
  if (rule.via === undefined) return { ok: true, target: null };
  const link = state.links.find((l) => l.relation === rule.via && l.from === actorId);
  return link === undefined ? { ok: false } : { ok: true, target: link.to };
}

export type ActorAccess = { ok: true; target: string | null } | { ok: false; code: 'actor_without_link' | 'actor_not_in_league' };

/**
 * May `actorId` act on `rule`, and for whom. `roster` is the players enrolled in the format's phases (`rosterOf`).
 * - an action without `via`: the actor is on the roster (an empty roster, before anybody is enrolled, lets everybody in);
 * - an action `via` a relation: the actor holds a link of it (`actor_without_link` otherwise) and is on the roster
 *   (`actor_not_in_league` otherwise, even with a link: a removed or substituted player keeps their link, not their turn).
 * The target is the `to` side of the link, null for a self action.
 */
export function actorAccess(
  rule: PlayerActionRule,
  actorId: string,
  state: Pick<KitRuntimeState, 'links'>,
  roster: readonly string[],
): ActorAccess {
  if (rule.via === undefined) {
    return roster.length > 0 && !roster.includes(actorId) ? { ok: false, code: 'actor_without_link' } : { ok: true, target: null };
  }
  const access = resolveActionTarget(rule, actorId, state);
  if (!access.ok) return { ok: false, code: 'actor_without_link' };
  return roster.includes(actorId) ? access : { ok: false, code: 'actor_not_in_league' };
}

/** Who is picking: a `player` sees what `visibleEntries` lets them, the `system` (a deadline pick) the whole list. */
export type ActionAudience = 'player' | 'system';

export interface ValidateActionOptions {
  /** Default `player`. */
  audience?: ActionAudience;
}

export function validateActionSubmission(
  def: FormatDefinition,
  actionId: string,
  actorId: string,
  picks: readonly ActionPick[],
  state: KitRuntimeState,
  roster: readonly string[],
  seed = '',
  options: ValidateActionOptions = {},
): ActionValidation {
  const audience: ActionAudience = options.audience ?? 'player';
  const rule = findAction(def, actionId);
  if (rule === null) return { ok: false, issues: [{ code: 'action_unknown' }] };
  const issues: ActionIssue[] = [];
  if (!isActionWindowOpen(rule, state)) issues.push({ code: 'window_closed' });
  const access = actorAccess(rule, actorId, state, roster);
  if (!access.ok) issues.push({ code: access.code });
  const target = access.ok ? access.target : null;
  const beneficiary = target ?? actorId;

  const base: EnvBase = { def, state, seed, scope: `action:${actionId}` };
  const resources = toMap(def.resources ?? [], (r) => r.key);
  const attributes = toMap(def.attributes ?? [], (a) => a.key);
  const previous = state.submissions.find((s) => s.action === actionId && s.actor === actorId);
  const replaced = (item: KitRuntimeState['items'][number]): boolean => item.source === 'action' && previous !== undefined && item.source_ref === previous.id;
  const taken = new Set(state.items.filter((i) => !replaced(i) && i.item_id !== null).map((i) => `${i.resource}\u0000${i.item_id}`));
  const heldUnits = new Map<string, number>();
  const pickedUnits = new Map<string, number>();
  const pickedItems = new Set<string>();
  const grants: ActionItemGrant[] = [];

  for (const pick of picks) {
    if (!Number.isInteger(pick.step) || pick.step < 0 || pick.step >= rule.steps.length) issues.push({ code: 'step_unknown', step: pick.step, item_id: pick.item_id });
  }

  rule.steps.forEach((step, index) => {
    const stepPicks = picks.filter((p) => p.step === index);
    if (stepPicks.length !== step.count) issues.push({ code: 'wrong_count', step: index });
    const resource = resources.get(step.resource);
    if (resource === undefined) {
      issues.push({ code: 'resource_unknown', step: index });
      return;
    }
    const domain = findDomainView(def, step.domain, state.flags, state.amendments);
    if (domain === null) {
      issues.push({ code: 'domain_unknown', step: index });
      return;
    }
    // A pool the player may not see (an `admins` domain, or a `when_unlocked` one that is still locked) is refused with
    // `domain_locked` alone: no per-pick answer, so the refusal never says which ids belong to the hidden pool.
    const hiddenPool = audience === 'player' && (domain.visibility === 'admins' || (domain.visibility === 'when_unlocked' && !domain.unlocked));
    if (hiddenPool || !domain.unlocked) issues.push({ code: 'domain_locked', step: index });
    if (hiddenPool) return;
    const entries = new Map<string, DomainEntry>(domain.entries.map((e) => [e.id, e]));
    const distinct = step.distinct_attr === undefined ? undefined : attributes.get(step.distinct_attr);
    const seen = new Set<string>();

    for (const pick of stepPicks) {
      const entry = entries.get(pick.item_id);
      if (entry === undefined) {
        issues.push({ code: 'item_outside_domain', step: index, item_id: pick.item_id });
        continue;
      }
      const itemKey = `${step.resource}\u0000${pick.item_id}`;
      if (pickedItems.has(itemKey)) {
        issues.push({ code: 'duplicate_item', step: index, item_id: pick.item_id });
        continue;
      }
      pickedItems.add(itemKey);
      if (step.where !== undefined) {
        const result = evaluate(step.where, entryContext(base, entry), 'boolean');
        if (!result.ok || result.value !== true) issues.push({ code: 'where_false', step: index, item_id: pick.item_id });
      }
      if (distinct !== undefined) {
        const value = entry.attrs.find((a) => a.key === distinct.key)?.value;
        if (value !== undefined) {
          const text = JSON.stringify(value);
          if (seen.has(text)) issues.push({ code: 'distinct_attr_duplicate', step: index, item_id: pick.item_id });
          seen.add(text);
        }
      }
      if (resource.capacity !== undefined) {
        const held =
          heldUnits.get(step.resource) ??
          state.items.filter((i) => i.resource === step.resource && i.player_id === beneficiary && !replaced(i)).reduce((sum, i) => sum + i.amount, 0);
        heldUnits.set(step.resource, held);
        const count = (pickedUnits.get(step.resource) ?? 0) + 1;
        pickedUnits.set(step.resource, count);
        if (held + count > resource.capacity) issues.push({ code: 'capacity_exceeded', step: index, item_id: pick.item_id });
      }
      const exclusive = resource.exclusive === 'global';
      if (exclusive && taken.has(itemKey)) issues.push({ code: 'resource_item_taken', step: index, item_id: pick.item_id });
      grants.push({ resource: step.resource, item_id: pick.item_id, exclusive });
    }
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, target, items: grants };
}
