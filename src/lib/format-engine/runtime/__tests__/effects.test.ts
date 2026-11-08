import { describe, expect, it } from 'vitest';
import type { Expr } from '@/lib/format-kit/expr/ast';
import type { FormatDefinition, RelationDef } from '@/lib/format-kit/types';
import { planEffects } from '../effects';
import { eventKey, eventMatches, type KitEvent } from '../events';
import { PLAYERS, SEED, giftDef, item, link, stateFor } from './helpers';

const def = giftDef();
const plan = (event: KitEvent, patch: Parameters<typeof stateFor>[1] = {}, rows = {}) =>
  planEffects(def, event, stateFor(def, patch), PLAYERS, SEED, { rows });

describe('eventKey and eventMatches', () => {
  it('builds a stable key per kind', () => {
    expect(eventKey({ event: 'stage_start', stage: 'main' })).toBe('stage_start:main');
    expect(eventKey({ event: 'round_start', stage: 'main', round: 2 })).toBe('round_start:main:2');
    expect(eventKey({ event: 'match_completed', match_id: 'm1' })).toBe('match_completed:m1');
    expect(eventKey({ event: 'action_locked', action: 'choose_gift' })).toBe('action_locked:choose_gift');
    expect(eventKey({ event: 'time', mark: 'gift_deadline' })).toBe('time:-:gift_deadline');
    expect(eventKey({ event: 'time', stage: 'cup', mark: 'kickoff' })).toBe('time:cup:kickoff');
    // The same mark key in two stages is two events.
    expect(eventKey({ event: 'time', stage: 'groups', mark: 'kickoff' })).not.toBe(eventKey({ event: 'time', stage: 'cup', mark: 'kickoff' }));
    expect(eventKey({ event: 'stage_end' })).toBe('stage_end:-');
  });

  it('matches on the fields the spec names only', () => {
    expect(eventMatches({ event: 'round_start', stage: 'main' }, { event: 'round_start', stage: 'main', round: 5 })).toBe(true);
    expect(eventMatches({ event: 'round_start', stage: 'main', round: 2 }, { event: 'round_start', stage: 'main', round: 5 })).toBe(false);
    expect(eventMatches({ event: 'stage_start', stage: 'other' }, { event: 'stage_start', stage: 'main' })).toBe(false);
    expect(eventMatches({ event: 'stage_start', stage: 'main' }, { event: 'stage_end', stage: 'main' })).toBe(false);
    expect(eventMatches({ event: 'time', mark: 'a' }, { event: 'time', mark: 'b' })).toBe(false);
  });
});

describe('planEffects on the gift exchange', () => {
  it('stage start unlocks, draws the derangement, grants coins and opens the action', () => {
    const out = plan({ event: 'stage_start', stage: 'main' });
    expect(out.issues).toEqual([]);
    const ops = out.ops;
    expect(ops[0]).toEqual({ op: 'set_flag', key: 'domain:pool', value: 'unlocked' });
    const relation = ops.find((o) => o.op === 'set_relation');
    expect(relation).toMatchObject({ op: 'set_relation', relation: 'santa' });
    expect(relation?.op === 'set_relation' ? relation.links : []).toHaveLength(PLAYERS.length);
    const grants = ops.filter((o) => o.op === 'grant_item');
    expect(grants).toHaveLength(PLAYERS.length);
    expect(grants[0]).toMatchObject({ resource: 'coins', amount: 3, item_id: null, source: 'event', source_ref: 'kickoff:stage_start:main' });
    expect(ops.filter((o) => o.op === 'open_action')).toEqual([{ op: 'open_action', action: 'choose_gift' }]);
    expect(out.notifications).toHaveLength(1);
    expect(out.notifications[0].players).toEqual([...PLAYERS]);
  });

  it('names the rule and the effect of a notice: with the event key they make its delivery idempotent', () => {
    const out = plan({ event: 'stage_start', stage: 'main' });
    expect(out.notifications[0]).toMatchObject({ rule: 'kickoff', effect: 4 });
  });

  describe('a notice whose recipients depend on a relation', () => {
    const where: Expr = { k: 'rel', relation: 'santa', a: { k: 'str', v: 'p1' }, b: { k: 'ref', name: 'player', t: 'text' } };
    const withWhere = (visibility?: RelationDef['visibility']): FormatDefinition => ({
      ...def,
      relations: (def.relations ?? []).map((relation) => (visibility === undefined ? relation : { ...relation, visibility })),
      rules: def.rules.map((rule) =>
        rule.kind === 'rule.on_event' && rule.id === 'kickoff'
          ? { ...rule, effects: rule.effects.map((effect) => (effect.effect === 'notify' ? { ...effect, to: { who: 'all' as const, where } } : effect)) }
          : rule,
      ),
    });
    const planWith = (format: FormatDefinition, revealed: boolean) =>
      planEffects(format, { event: 'stage_start', stage: 'main' }, stateFor(format, { links: [{ ...link('p1', 'p2'), revealed }] }), PLAYERS, SEED, {});

    it('is held back while a link is unrevealed: being told would name the giver', () => {
      const out = planWith(withWhere(), false);
      expect(out.notifications).toEqual([]);
      expect(out.issues).toContainEqual({ code: 'notify_relation_hidden', rule: 'kickoff', detail: 'santa' });
    });

    it('is delivered once every link is revealed', () => {
      expect(planWith(withWhere(), true).notifications[0].players).toEqual(['p2']);
    });

    it('is delivered for a relation everybody may see', () => {
      expect(planWith(withWhere({ from: 'all', to: 'all' }), false).notifications[0].players).toEqual(['p2']);
    });
  });

  it('is deterministic for a seed and does not redraw existing links', () => {
    const a = plan({ event: 'stage_start', stage: 'main' });
    expect(plan({ event: 'stage_start', stage: 'main' })).toEqual(a);
    const again = plan({ event: 'stage_start', stage: 'main' }, { links: [link('p1', 'p2')] });
    expect(again.ops.some((o) => o.op === 'set_relation')).toBe(false);
  });

  it('clamps a grant to the capacity left', () => {
    const out = plan({ event: 'stage_start', stage: 'main' }, { items: [item({ resource: 'coins', player_id: 'p1', amount: 9 })] });
    const first = out.ops.find((o) => o.op === 'grant_item' && o.player_id === 'p1');
    expect(first).toMatchObject({ amount: 1 });
    const full = plan({ event: 'stage_start', stage: 'main' }, { items: [item({ resource: 'coins', player_id: 'p2', amount: 10 })] });
    expect(full.ops.some((o) => o.op === 'grant_item' && o.player_id === 'p2')).toBe(false);
    expect(full.issues).toContainEqual({ code: 'capacity_reached', rule: 'kickoff', detail: 'coins:p2' });
  });

  it('round end 2 adjusts, sets attrs, revokes, grants, reveals and locks', () => {
    const rows = { p1: { wins: 2 }, p2: { wins: 0 } };
    const out = plan({ event: 'round_end', stage: 'main', round: 2, players: ['p1', 'p2'] }, { items: [item({ resource: 'coins', player_id: 'p1', amount: 3 })] }, rows);
    // The exclusive pick goes to the first player of the roster only; the five others are reported as skipped.
    expect(out.issues.map((i) => i.code)).toEqual(Array(PLAYERS.length - 1).fill('resource_item_taken'));
    expect(out.ops.filter((o) => o.op === 'grant_item' && o.resource === 'picks')).toHaveLength(1);
    expect(out.ops.filter((o) => o.op === 'adjust_points')).toEqual([
      { op: 'adjust_points', stage: 'main', player_id: 'p1', points: 1, reason: 'midway (round_end:main:2)' },
    ]);
    expect(out.ops.filter((o) => o.op === 'set_attr').map((o) => (o.op === 'set_attr' ? o.player_id : ''))).toEqual(['p1', 'p2']);
    expect(out.ops.filter((o) => o.op === 'revoke_item')).toEqual([{ op: 'revoke_item', resource: 'coins', player_id: 'p1', item_id: null, amount: 1 }]);
    expect(out.ops.filter((o) => o.op === 'grant_item')[0]).toMatchObject({ resource: 'picks', item_id: 'blissey', exclusive: true, amount: 1 });
    expect(out.ops).toContainEqual({ op: 'reveal_relation', relation: 'santa' });
    expect(out.ops).toContainEqual({ op: 'lock_action', action: 'choose_gift' });
    expect(out.ops).toContainEqual({ op: 'set_flag', key: 'domain:pool', value: 'locked' });
  });

  it('skips an exclusive item somebody holds, and an attr that already has the value', () => {
    const state = {
      items: [item({ resource: 'picks', player_id: 'p9', item_id: 'blissey', exclusive: true })],
      attrs: { p1: { veteran: true } },
    };
    const out = plan({ event: 'round_end', stage: 'main', round: 2, players: ['p1', 'p2'] }, state, { p1: { wins: 1 } });
    expect(out.ops.some((o) => o.op === 'grant_item')).toBe(false);
    expect(out.issues.some((i) => i.code === 'resource_item_taken')).toBe(true);
    expect(out.ops.filter((o) => o.op === 'set_attr').map((o) => (o.op === 'set_attr' ? o.player_id : ''))).toEqual(['p2']);
  });

  it('does not fire a rule whose when is false', () => {
    const out = plan({ event: 'round_end', stage: 'main', round: 1 });
    expect(out.ops).toEqual([]);
  });

  it('a time mark and an action window lock the action once', () => {
    expect(plan({ event: 'time', mark: 'gift_deadline' }).ops).toEqual([{ op: 'lock_action', action: 'choose_gift' }]);
    const start = plan({ event: 'round_start', stage: 'main', round: 2 });
    expect(start.ops.filter((o) => o.op === 'lock_action')).toEqual([{ op: 'lock_action', action: 'choose_gift' }]);
    expect(start.notifications).toHaveLength(1);
  });

  it('the lock of the action reveals the relation', () => {
    expect(plan({ event: 'action_locked', action: 'choose_gift' }).ops).toEqual([{ op: 'reveal_relation', relation: 'santa' }]);
  });

  it('dedupes a reveal asked by a rule and by the relation', () => {
    const ops = plan({ event: 'stage_end', stage: 'main' }).ops;
    expect(ops.filter((o) => o.op === 'reveal_relation')).toHaveLength(1);
  });
});
