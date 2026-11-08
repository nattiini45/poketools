/**
 * Late joiners: the players who sit in a stage's phases now but were not there when a one-time event of that stage fired,
 * and what that event did for the others. A player an admin adds after the stage started (a forced roster change) gets
 * nothing automatic: the grants, points, attributes and relation draws of `stage_start`, a round start or any other event
 * were made for the roster the event fired with, and an event fires once. The admin overview lists, per late player, the
 * events they missed so the admin can make good by hand (an adjustment).
 *
 * Read from the event log and the stage plan, no extra bookkeeping:
 * - the plan: the roster-wide effects of the rules that match the event (`rule.on_event` effects aimed at `all`, or at
 *   `event_players` when the event names none, without a `where`; an exclusive item is left out, only one player can hold it);
 * - the log: the `ops` the event applied. An effect counts as having happened when its op is there (a rule whose `when`
 *   was false, or whose targets were all skipped, left none), and the event's audience is every player any of those ops
 *   named (a grant, a points change, an attribute, an end of a relation link).
 * A substitution moves the seat of the player who left, with every row the event made for them, to the substitute
 * (`format_substitute_seat` logs one `seat_moved` {from, to}). The ops of an event that fired before the move still name the
 * player who left, so the audience follows the `seat_moved` rows logged AFTER the event (the log is in firing order) to the
 * player who holds the seat now: the substitute did not miss what the seat already got.
 * A player of the event's roster (the stage's, else the league's) who is not in the audience is late for it. A player who
 * was skipped for a reason of their own (a capacity already used, an attribute they already held) is not told apart from
 * a late one when they got nothing else; an attribute they already hold the value of is never listed as missed.
 *
 * Masking: the list says who holds nothing of an effect, which is a fact about other players' holdings. A viewer who takes
 * part in the league (`viewer.plays`: an admin who also plays) therefore does not get, for another player, a missed grant of
 * a resource that is not visible to all (`adjustmentMaskOf`), a missed attribute (attributes are never public), or the
 * missed draw of a relation that still hides a side (the missing link would narrow the viewer's own giver). A player with
 * nothing left to show is not listed. Pure and client-safe.
 */
import type { Effect, FormatDefinition } from '@/lib/format-kit/types';
import type { Json } from '@/types/database';
import { eventKey, eventMatches, type KitEvent } from './events';
import { SEAT_MOVED_EVENT } from './seat-succession';
import { own, type KitRuntimeState } from './types';
import type { LateJoinerView, MissedEffect, MissedEvent } from './view-types';

/** A row of the league's event log: the key, the event kind, the payload the event was fired with and the ops it applied. */
export interface FiredEventRecord {
  event_key: string;
  event: string;
  payload: Json;
  ops: Json;
}

/** What the builder reads of the league: the format, the runtime state, and the players of each stage's phases. */
export interface LateJoinerContext {
  def: Pick<FormatDefinition, 'rules' | 'resources' | 'relations' | 'attributes'>;
  state: Pick<KitRuntimeState, 'links' | 'attrs'>;
  phases: readonly { stage: { key: string; name?: MissedEvent['stage_label'] }; members: readonly string[] }[];
}

const EVENT_KINDS: readonly KitEvent['event'][] = ['stage_start', 'stage_end', 'match_completed', 'round_start', 'round_end', 'action_locked', 'time'];

const isRecord = (value: Json | undefined): value is { [key: string]: Json | undefined } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The event a log row recorded (its payload is `payloadOf` of `fire.ts`), or null for a row that is not one. */
export function kitEventOfRecord(record: Pick<FiredEventRecord, 'payload'>): KitEvent | null {
  const payload = record.payload;
  if (!isRecord(payload)) return null;
  const event = EVENT_KINDS.find((candidate) => candidate === payload.event);
  if (event === undefined) return null;
  return {
    event,
    ...(typeof payload.stage === 'string' ? { stage: payload.stage } : {}),
    ...(typeof payload.round === 'number' ? { round: payload.round } : {}),
    ...(typeof payload.action === 'string' ? { action: payload.action } : {}),
    ...(typeof payload.mark === 'string' ? { mark: payload.mark } : {}),
    ...(typeof payload.match_id === 'string' ? { match_id: payload.match_id } : {}),
    ...(Array.isArray(payload.players) ? { players: payload.players.filter((id): id is string => typeof id === 'string') } : {}),
  };
}

interface PlannedEffect {
  rule: string;
  effect: Effect;
  kind: MissedEffect['kind'];
  key: string;
}

/** The roster-wide effects of the rules matching `event` (see the header). */
function rosterWideEffects(def: LateJoinerContext['def'], event: KitEvent): PlannedEffect[] {
  const resources = new Map((def.resources ?? []).map((resource) => [resource.key, resource] as const));
  const wide = (to: { who: string; where?: unknown }): boolean =>
    to.where === undefined && (to.who === 'all' || (to.who === 'event_players' && event.players === undefined));
  const out: PlannedEffect[] = [];
  for (const rule of def.rules) {
    if (rule.kind !== 'rule.on_event' || !eventMatches(rule.on, event)) continue;
    for (const effect of rule.effects) {
      switch (effect.effect) {
        case 'grant_resource': {
          const resource = resources.get(effect.resource);
          // Only one player can hold an exclusive item: the others are skipped by design, not by joining late.
          if (!wide(effect.to) || resource === undefined || (resource.exclusive === 'global' && effect.item !== undefined)) break;
          out.push({ rule: rule.id, effect, kind: 'grant_resource', key: effect.resource });
          break;
        }
        case 'adjust_points':
          if (wide(effect.to)) out.push({ rule: rule.id, effect, kind: 'adjust_points', key: effect.stage });
          break;
        case 'set_attr':
          if (wide(effect.to)) out.push({ rule: rule.id, effect, kind: 'set_attr', key: effect.attr });
          break;
        case 'generate_relation': {
          const relation = (def.relations ?? []).find((candidate) => candidate.key === effect.relation);
          if (relation !== undefined && relation.shape !== 'manual') out.push({ rule: rule.id, effect, kind: 'generate_relation', key: effect.relation });
          break;
        }
        default:
          break;
      }
    }
  }
  return out;
}

/** The players the logged ops of `planned` named, or null when the log holds no op of it (the effect did not happen). */
function recipientsOf(planned: PlannedEffect, ops: readonly Json[], keyOfEvent: string): Set<string> | null {
  const { effect } = planned;
  const who = new Set<string>();
  let happened = false;
  const addPlayer = (op: { [key: string]: Json | undefined }): void => {
    happened = true;
    if (typeof op.player_id === 'string') who.add(op.player_id);
  };
  for (const op of ops) {
    if (!isRecord(op)) continue;
    if (effect.effect === 'grant_resource' && op.op === 'grant_item' && op.resource === effect.resource && op.source_ref === `${planned.rule}:${keyOfEvent}`) {
      addPlayer(op);
    } else if (effect.effect === 'adjust_points' && op.op === 'adjust_points' && op.stage === effect.stage && op.reason === `${planned.rule} (${keyOfEvent})`) {
      addPlayer(op);
    } else if (effect.effect === 'set_attr' && op.op === 'set_attr' && op.attr === effect.attr && op.source === 'event') {
      addPlayer(op);
    } else if (effect.effect === 'generate_relation' && op.op === 'set_relation' && op.relation === effect.relation) {
      happened = true;
      for (const link of Array.isArray(op.links) ? op.links : []) {
        if (!isRecord(link)) continue;
        if (typeof link.from === 'string') who.add(link.from);
        if (typeof link.to === 'string') who.add(link.to);
      }
    }
  }
  return happened ? who : null;
}

/** The seat moves of the log with their position in it (the log is in firing order), unreadable rows left out. */
function seatMovesInLog(events: readonly FiredEventRecord[]): { at: number; from: string; to: string }[] {
  const moves: { at: number; from: string; to: string }[] = [];
  events.forEach((record, at) => {
    if (record.event !== SEAT_MOVED_EVENT || !isRecord(record.payload)) return;
    const { from, to } = record.payload;
    if (typeof from === 'string' && typeof to === 'string') moves.push({ at, from, to });
  });
  return moves;
}

export interface LateJoinerViewer {
  id: string;
  /** The viewer takes part in the league (enrolled in a phase, or holds a link): the masks apply. */
  plays: boolean;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The late joiners of the league and the events each missed, for `viewer`. `names` decides each `PlayerRef` (a player who is
 * not a current participant has `name: null`). Players are sorted by name, then id; events in the order they fired.
 */
export function buildLateJoiners(
  ctx: LateJoinerContext,
  events: readonly FiredEventRecord[],
  names: ReadonlyMap<string, string>,
  viewer: LateJoinerViewer,
): LateJoinerView[] {
  const { def, state } = ctx;
  const stageLabels = new Map(ctx.phases.map((phase) => [phase.stage.key, phase.stage.name ?? null] as const));
  const rosterOf = (stage: string | undefined): string[] => {
    const phases = stage !== undefined && stageLabels.has(stage) ? ctx.phases.filter((phase) => phase.stage.key === stage) : ctx.phases;
    return [...new Set(phases.flatMap((phase) => phase.members))].sort(byId);
  };
  const openResources = new Set((def.resources ?? []).filter((resource) => resource.visibility === 'all').map((resource) => resource.key));
  const labels = {
    grant_resource: new Map((def.resources ?? []).map((resource) => [resource.key, resource.label] as const)),
    set_attr: new Map((def.attributes ?? []).map((attribute) => [attribute.key, attribute.label] as const)),
    generate_relation: new Map((def.relations ?? []).map((relation) => [relation.key, relation.label] as const)),
    adjust_points: stageLabels,
  };
  const relationOpen = (key: string): boolean => {
    const relation = (def.relations ?? []).find((candidate) => candidate.key === key);
    if (relation === undefined) return false;
    const links = state.links.filter((link) => link.relation === key);
    return (relation.visibility.from === 'all' && relation.visibility.to === 'all') || (links.length > 0 && links.every((link) => link.revealed));
  };

  const seatMoves = seatMovesInLog(events);
  /** Who holds `playerId`'s seat now, counting the moves logged after position `after` (a chain A -> B -> C resolves to C). */
  const holderNow = (playerId: string, after: number): string => {
    let holder = playerId;
    for (const move of seatMoves) if (move.at > after && move.from === holder) holder = move.to;
    return holder;
  };

  const missedBy = new Map<string, MissedEvent[]>();
  for (const [position, record] of events.entries()) {
    const event = kitEventOfRecord(record);
    if (event === null || event.event === 'match_completed' || eventKey(event) !== record.event_key) continue;
    const ops = Array.isArray(record.ops) ? record.ops : [];
    const happened = rosterWideEffects(def, event).flatMap((planned) => {
      const recipients = recipientsOf(planned, ops, record.event_key);
      return recipients === null ? [] : [{ planned, recipients }];
    });
    const audience = new Set(happened.flatMap(({ recipients }) => [...recipients].map((id) => holderNow(id, position))));
    if (audience.size === 0) continue;

    for (const playerId of rosterOf(event.stage)) {
      if (audience.has(playerId)) continue;
      const effects: MissedEffect[] = [];
      for (const { planned } of happened) {
        const { effect } = planned;
        // An attribute the player already holds (set by hand, or by an earlier event) is not missing.
        if (effect.effect === 'set_attr' && own(own(state.attrs, playerId), effect.attr) === effect.value) continue;
        // The masks: another player's holding of a resource, an attribute or a hidden relation is not the viewer's to learn.
        if (viewer.plays && playerId !== viewer.id) {
          if (planned.kind === 'grant_resource' && !openResources.has(planned.key)) continue;
          if (planned.kind === 'set_attr') continue;
          if (planned.kind === 'generate_relation' && !relationOpen(planned.key)) continue;
        }
        effects.push({ kind: planned.kind, key: planned.key, label: labels[planned.kind].get(planned.key) ?? null });
      }
      if (effects.length === 0) continue;
      const list = missedBy.get(playerId) ?? [];
      list.push({
        event: event.event,
        stage: event.stage ?? null,
        stage_label: event.stage === undefined ? null : (stageLabels.get(event.stage) ?? null),
        round: event.round ?? null,
        action: event.action ?? null,
        mark: event.mark ?? null,
        effects,
      });
      missedBy.set(playerId, list);
    }
  }

  return [...missedBy.entries()]
    .map(([id, missed]): LateJoinerView => ({ player: { id, name: names.get(id) ?? null }, missed }))
    .sort((a, b) => (a.player.name ?? '').localeCompare(b.player.name ?? '') || byId(a.player.id, b.player.id));
}
