/**
 * Event effects: the ops an event causes. `planEffects` walks the format in a fixed order and returns what the
 * database must apply (`format_fire_event` runs the ops in this order inside one transaction), plus the notifications
 * to deliver and the problems it skipped:
 *
 * 1. every `rule.on_event` whose trigger matches the event and whose `when` (event env) is true, effect by effect;
 * 2. every relation whose `reveal_on` matches: `reveal_relation`;
 * 3. every `player.action` whose window opens (`open_action`) or closes (`lock_action`) on the event.
 *
 * Targets resolve through the player env: `all` is the roster, `event_players` the players the event names (the
 * roster when it names none), narrowed by `where`. A grant never exceeds the resource's `capacity` and never takes an
 * exclusive item somebody holds (the database would roll the whole event back on that); both are skipped and reported.
 * Pure and client-safe.
 */
import { evaluate } from '@/lib/format-kit/expr/eval';
import { relationsRead } from '@/lib/format-kit/expr/relations-read';
import type { Effect, EffectTarget, FormatDefinition, LText, ResourceDef } from '@/lib/format-kit/types';
import { toMap } from '@/lib/studio-core/keys';
import { domainFlagKey } from './domains';
import { eventKey, eventMatches, type KitEvent } from './events';
import { eventContext, playerContext, type EnvBase } from './expr-env';
import { generateRelationLinks } from './relations';
import { own, type FormatOp, type KitRuntimeState, type PlayerRow, type RuntimeIssue } from './types';

export interface PlannedNotification {
  message: LText;
  players: string[];
  /** The rule and the position of the effect in it: with the event key and revision they make the delivery idempotent. */
  rule: string;
  effect: number;
}

export interface EffectPlan {
  ops: FormatOp[];
  notifications: PlannedNotification[];
  issues: RuntimeIssue[];
}

export interface PlanOptions {
  /** The standings row per player, for a target's `where` that reads `wins`, `points` and the like. */
  rows?: Readonly<Record<string, PlayerRow>>;
}

interface Held {
  resource: string;
  player_id: string;
  item_id: string | null;
  amount: number;
}

class Planner {
  readonly ops: FormatOp[] = [];
  readonly notifications: PlannedNotification[] = [];
  readonly issues: RuntimeIssue[] = [];
  private readonly resources: Map<string, ResourceDef>;
  private readonly stages: Set<string>;
  private readonly held: Held[];
  private readonly generated = new Set<string>();
  private rule: string | undefined;
  private effectIndex = 0;

  constructor(
    private readonly def: FormatDefinition,
    private readonly event: KitEvent,
    private readonly state: KitRuntimeState,
    private readonly roster: readonly string[],
    private readonly base: EnvBase,
    private readonly options: PlanOptions,
  ) {
    this.resources = toMap(def.resources ?? [], (r) => r.key);
    this.stages = new Set(def.stages.map((s) => s.key));
    this.held = state.items.map((i) => ({ resource: i.resource, player_id: i.player_id, item_id: i.item_id, amount: i.amount }));
  }

  private issue(code: string, detail?: string): void {
    this.issues.push({ code, ...(this.rule !== undefined ? { rule: this.rule } : {}), ...(detail !== undefined ? { detail } : {}) });
  }

  private push(op: FormatOp): void {
    const text = JSON.stringify(op);
    if (this.ops.some((o) => JSON.stringify(o) === text) && (op.op === 'open_action' || op.op === 'lock_action' || op.op === 'reveal_relation')) return;
    this.ops.push(op);
  }

  private targets(target: EffectTarget): string[] {
    const pool = target.who === 'event_players' ? (this.event.players ?? this.roster) : this.roster;
    const where = target.where;
    if (where === undefined) return [...pool];
    return pool.filter((playerId) => {
      const ctx = playerContext(this.base, playerId, this.options.rows?.[playerId], this.roster.length);
      const result = evaluate(where, ctx, 'boolean');
      if (!result.ok) {
        this.issue('where_failed', `${playerId}:${result.issue.code}`);
        return false;
      }
      return result.value === true;
    });
  }

  private units(resource: string, player: string, item?: string | null): number {
    return this.held
      .filter((h) => h.resource === resource && h.player_id === player && (item === undefined || h.item_id === item))
      .reduce((sum, h) => sum + h.amount, 0);
  }

  private takenBySomeone(resource: string, item: string): boolean {
    return this.held.some((h) => h.resource === resource && h.item_id === item && h.amount > 0);
  }

  private grant(effect: Extract<Effect, { effect: 'grant_resource' }>): void {
    const resource = this.resources.get(effect.resource);
    if (resource === undefined) return this.issue('resource_unknown', effect.resource);
    const domainBound = resource.holds.kind === 'domain';
    const item = domainBound ? (effect.item ?? null) : null;
    if (domainBound && item === null) return this.issue('grant_item_missing', effect.resource);
    const exclusive = resource.exclusive === 'global' && item !== null;
    for (const playerId of this.targets(effect.to)) {
      if (exclusive && item !== null && this.takenBySomeone(effect.resource, item)) {
        this.issue('resource_item_taken', `${effect.resource}:${item}`);
        continue;
      }
      // The capacity caps an exclusive grant (one unit) like any other.
      const room = resource.capacity === undefined ? Infinity : resource.capacity - this.units(effect.resource, playerId);
      const amount = Math.min(exclusive ? 1 : effect.amount, room);
      if (amount < 1) {
        this.issue('capacity_reached', `${effect.resource}:${playerId}`);
        continue;
      }
      this.held.push({ resource: effect.resource, player_id: playerId, item_id: item, amount });
      this.push({
        op: 'grant_item',
        resource: effect.resource,
        player_id: playerId,
        item_id: item,
        amount,
        exclusive,
        source: 'event',
        source_ref: `${this.rule ?? 'event'}:${eventKey(this.event)}`,
      });
    }
  }

  private takeAway(resource: string, player: string, item: string | null, amount: number): void {
    let left = amount;
    for (const h of this.held) {
      if (left <= 0) break;
      if (h.resource !== resource || h.player_id !== player || h.item_id !== item || h.amount <= 0) continue;
      const take = Math.min(left, h.amount);
      h.amount -= take;
      left -= take;
    }
  }

  private revoke(effect: Extract<Effect, { effect: 'revoke_resource' }>): void {
    const resource = this.resources.get(effect.resource);
    if (resource === undefined) return this.issue('resource_unknown', effect.resource);
    const domainBound = resource.holds.kind === 'domain';
    for (const playerId of this.targets(effect.to)) {
      if (domainBound && effect.item === undefined) {
        // No item named: the player's oldest items of the resource go first, one revoke per item.
        let left = effect.amount;
        const items = this.held.filter((h) => h.resource === effect.resource && h.player_id === playerId && h.amount > 0);
        for (const held of items) {
          if (left <= 0) break;
          const take = Math.min(left, held.amount);
          this.push({ op: 'revoke_item', resource: effect.resource, player_id: playerId, item_id: held.item_id, amount: take });
          held.amount -= take;
          left -= take;
        }
        continue;
      }
      const item = domainBound ? (effect.item ?? null) : null;
      const amount = Math.min(effect.amount, this.units(effect.resource, playerId, item));
      if (amount < 1) continue;
      this.takeAway(effect.resource, playerId, item, amount);
      this.push({ op: 'revoke_item', resource: effect.resource, player_id: playerId, item_id: item, amount });
    }
  }

  private setAttr(effect: Extract<Effect, { effect: 'set_attr' }>): void {
    const attr = (this.def.attributes ?? []).find((a) => a.key === effect.attr);
    if (attr === undefined || attr.on !== 'player') return this.issue('attr_unknown', effect.attr);
    const fits =
      (attr.type === 'number' && typeof effect.value === 'number') ||
      (attr.type === 'bool' && typeof effect.value === 'boolean') ||
      (attr.type === 'text' && typeof effect.value === 'string') ||
      (attr.type === 'enum' && typeof effect.value === 'string' && attr.values?.includes(effect.value) === true);
    if (!fits) return this.issue('attr_value_mismatch', effect.attr);
    for (const playerId of this.targets(effect.to)) {
      if (own(own(this.state.attrs, playerId), attr.key) === effect.value) continue;
      this.push({ op: 'set_attr', player_id: playerId, attr: effect.attr, value: effect.value, source: 'event' });
    }
  }

  /**
   * A relation the target of a `notify` reads and a player may not fully see yet, or undefined. Being on the list of a
   * notice selected by such a relation would tell the recipient who is linked to whom, so the notice is not delivered. The
   * event still fires and its key is spent: a later reveal does not bring the notice back.
   */
  private hiddenRelationIn(target: EffectTarget): string | undefined {
    if (target.where === undefined) return undefined;
    return relationsRead(target.where, this.def.attributes).find((key) => {
      const visibility = (this.def.relations ?? []).find((relation) => relation.key === key)?.visibility;
      if (visibility?.from === 'all' && visibility.to === 'all') return false;
      return this.state.links.some((link) => link.relation === key && !link.revealed);
    });
  }

  apply(effect: Effect): void {
    switch (effect.effect) {
      case 'unlock_domain':
        return this.push({ op: 'set_flag', key: domainFlagKey(effect.domain), value: 'unlocked' });
      case 'lock_domain':
        return this.push({ op: 'set_flag', key: domainFlagKey(effect.domain), value: 'locked' });
      case 'reveal_relation':
        return this.push({ op: 'reveal_relation', relation: effect.relation });
      case 'generate_relation': {
        const relation = (this.def.relations ?? []).find((r) => r.key === effect.relation);
        if (relation === undefined) return this.issue('relation_unknown', effect.relation);
        if (relation.shape === 'manual') return this.issue('relation_manual', relation.key);
        if (this.state.links.some((l) => l.relation === relation.key) || this.generated.has(relation.key)) return;
        this.generated.add(relation.key);
        const links = generateRelationLinks(relation, this.roster, this.base.seed);
        if (links.length === 0) return this.issue('relation_roster_too_small', relation.key);
        return this.push({ op: 'set_relation', relation: relation.key, links });
      }
      case 'grant_resource':
        return this.grant(effect);
      case 'revoke_resource':
        return this.revoke(effect);
      case 'adjust_points': {
        if (!this.stages.has(effect.stage)) return this.issue('stage_unknown', effect.stage);
        for (const playerId of this.targets(effect.to)) {
          this.push({
            op: 'adjust_points',
            stage: effect.stage,
            player_id: playerId,
            points: effect.points,
            reason: `${this.rule ?? 'event'} (${eventKey(this.event)})`,
          });
        }
        return;
      }
      case 'set_attr':
        return this.setAttr(effect);
      case 'open_action':
        return this.push({ op: 'open_action', action: effect.action });
      case 'lock_action':
        return this.push({ op: 'lock_action', action: effect.action });
      case 'notify': {
        const hidden = this.hiddenRelationIn(effect.to);
        if (hidden !== undefined) return this.issue('notify_relation_hidden', hidden);
        this.notifications.push({ message: effect.message, players: this.targets(effect.to), rule: this.rule ?? 'event', effect: this.effectIndex });
        return;
      }
    }
  }

  run(): void {
    const whenCtx = eventContext(this.base, this.event.round);
    for (const rule of this.def.rules) {
      if (rule.kind !== 'rule.on_event' || !eventMatches(rule.on, this.event)) continue;
      this.rule = rule.id;
      if (rule.when !== undefined) {
        const result = evaluate(rule.when, whenCtx, 'boolean');
        if (!result.ok) {
          this.issue('when_failed', result.issue.code);
          continue;
        }
        if (result.value !== true) continue;
      }
      for (const [index, effect] of rule.effects.entries()) {
        this.effectIndex = index;
        this.apply(effect);
      }
    }
    this.rule = undefined;
    for (const relation of this.def.relations ?? []) {
      if (relation.reveal_on !== undefined && eventMatches(relation.reveal_on, this.event)) {
        this.push({ op: 'reveal_relation', relation: relation.key });
      }
    }
    for (const rule of this.def.rules) {
      if (rule.kind !== 'player.action') continue;
      if (rule.window.opens_on !== undefined && eventMatches(rule.window.opens_on, this.event)) this.push({ op: 'open_action', action: rule.id });
      if (rule.window.closes_on !== undefined && eventMatches(rule.window.closes_on, this.event)) this.push({ op: 'lock_action', action: rule.id });
    }
  }
}

/** The ops, notifications and skipped problems of `event` for a format at `state` (`seed`: the season seed, server side). */
export function planEffects(
  def: FormatDefinition,
  event: KitEvent,
  state: KitRuntimeState,
  roster: readonly string[],
  seed: string,
  options: PlanOptions = {},
): EffectPlan {
  const sortedRoster = [...new Set(roster)].sort();
  const planner = new Planner(def, event, state, sortedRoster, { def, state, seed, scope: `event:${eventKey(event)}` }, options);
  planner.run();
  return { ops: planner.ops, notifications: planner.notifications, issues: planner.issues };
}

/** Whether firing `event` evaluates a target `where`, i.e. needs the standings rows of `PlanOptions.rows`. */
export function eventNeedsRows(def: FormatDefinition, event: KitEvent): boolean {
  return def.rules.some(
    (rule) =>
      rule.kind === 'rule.on_event' &&
      eventMatches(rule.on, event) &&
      rule.effects.some((effect) => 'to' in effect && effect.to.where !== undefined),
  );
}
