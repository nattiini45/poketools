/**
 * Late joiners (`late-joiners.ts`): a player who sits in a stage's phases but is not in the audience of a one-time event of
 * that stage missed it. The list is read from the event log (the ops the event applied) and the stage plan (the roster-wide
 * effects of the rules that match it), and it keeps the masks of the admin overview for an admin who also plays.
 */
import { describe, expect, it } from 'vitest';
import type { Json } from '@/types/database';
import { buildAdminOverview, NOT_RUNNING_OVERVIEW } from '../views';
import { buildLateJoiners, kitEventOfRecord, type FiredEventRecord, type LateJoinerContext } from '../late-joiners';
import type { KitContext } from '../load';
import { PLAYERS, SEED, giftDef, link, stateFor } from './helpers';

const text = (en: string) => ({ en: { v: en, s: 'human' as const }, base: 'en' as const });
const NAMES = new Map(PLAYERS.map((id) => [id, `Name ${id}`]));

const everyone = { who: 'all' } as const;

/** A format with one rule per kind of effect on the start of the stage `swiss`, plus a round start rule. */
function def(overrides: Partial<LateJoinerContext['def']> = {}): LateJoinerContext['def'] {
  return {
    rules: [
      {
        kind: 'rule.on_event',
        id: 'welcome',
        on: { event: 'stage_start', stage: 'swiss' },
        effects: [
          { effect: 'grant_resource', resource: 'coins', to: everyone, amount: 2 },
          { effect: 'grant_resource', resource: 'secret_coins', to: everyone, amount: 1 },
          { effect: 'adjust_points', stage: 'swiss', to: everyone, points: 1 },
          { effect: 'set_attr', attr: 'mood', to: everyone, value: 'calm' },
          { effect: 'generate_relation', relation: 'santa' },
        ],
      },
      {
        kind: 'rule.on_event',
        id: 'weekly',
        on: { event: 'round_start', stage: 'swiss' },
        effects: [{ effect: 'grant_resource', resource: 'coins', to: everyone, amount: 1 }],
      },
    ],
    resources: [
      { key: 'coins', label: text('Coins'), holds: { kind: 'counter' }, visibility: 'all', exclusive: 'none' },
      { key: 'secret_coins', label: text('Secret coins'), holds: { kind: 'counter' }, visibility: 'own', exclusive: 'none' },
    ],
    relations: [{ key: 'santa', label: text('Santa'), shape: 'derangement', visibility: { from: 'hidden', to: 'own' } }],
    attributes: [{ key: 'mood', label: text('Mood'), on: 'player', type: 'text' }],
    ...overrides,
  } as LateJoinerContext['def'];
}

const grant = (resource: string, player: string, ruleAndKey: string): Json => ({
  op: 'grant_item',
  resource,
  player_id: player,
  item_id: null,
  amount: 1,
  exclusive: false,
  source: 'event',
  source_ref: ruleAndKey,
});
const points = (player: string, reason: string): Json => ({ op: 'adjust_points', stage: 'swiss', player_id: player, points: 1, reason });

/** The ops of the stage start of `swiss` for `players`. */
function stageStartOps(players: string[]): Json[] {
  const ring = players.map((from, i) => ({ from, to: players[(i + 1) % players.length] }));
  return [
    ...players.map((p) => grant('coins', p, 'welcome:stage_start:swiss')),
    ...players.map((p) => grant('secret_coins', p, 'welcome:stage_start:swiss')),
    ...players.map((p) => points(p, 'welcome (stage_start:swiss)')),
    ...players.map((p): Json => ({ op: 'set_attr', player_id: p, attr: 'mood', value: 'calm', source: 'event' })),
    { op: 'set_relation', relation: 'santa', links: ring },
  ];
}

const stageStart = (ops: Json[], stage = 'swiss'): FiredEventRecord => ({
  event_key: `stage_start:${stage}`,
  event: 'stage_start',
  payload: { event: 'stage_start', stage },
  ops,
});

function league(members: Record<string, string[]>, patch: Partial<LateJoinerContext['state']> = {}): LateJoinerContext {
  return {
    def: def(),
    state: { links: [], attrs: {}, ...patch },
    phases: Object.entries(members).map(([key, list]) => ({ stage: { key, name: text(key) }, members: list })),
  };
}

const admin = { id: 'admin-1', plays: false };
const missedKinds = (result: ReturnType<typeof buildLateJoiners>, player: string) =>
  result.find((entry) => entry.player.id === player)?.missed.flatMap((event) => event.effects.map((effect) => effect.kind)) ?? [];

describe('buildLateJoiners', () => {
  it('lists a player who joined after the stage start with every roster-wide effect of that event', () => {
    const ctx = league({ swiss: ['p1', 'p2', 'p3', 'p4'] });
    const result = buildLateJoiners(ctx, [stageStart(stageStartOps(['p1', 'p2', 'p3']))], NAMES, admin);

    expect(result).toHaveLength(1);
    expect(result[0].player).toEqual({ id: 'p4', name: 'Name p4' });
    expect(result[0].missed).toHaveLength(1);
    expect(result[0].missed[0]).toMatchObject({ event: 'stage_start', stage: 'swiss', round: null, action: null, mark: null });
    expect(result[0].missed[0].effects.map((effect) => `${effect.kind}:${effect.key}`)).toEqual([
      'grant_resource:coins',
      'grant_resource:secret_coins',
      'adjust_points:swiss',
      'set_attr:mood',
      'generate_relation:santa',
    ]);
    expect(result[0].missed[0].stage_label).toEqual(text('swiss'));
  });

  it('lists nobody when every player of the stage was in the audience', () => {
    const ctx = league({ swiss: ['p1', 'p2', 'p3'] });
    expect(buildLateJoiners(ctx, [stageStart(stageStartOps(['p1', 'p2', 'p3']))], NAMES, admin)).toEqual([]);
  });

  it('lists only the events a player missed: one that fired after they joined is not on the list', () => {
    const ctx = league({ swiss: ['p1', 'p2', 'p4'] });
    const events: FiredEventRecord[] = [
      stageStart(stageStartOps(['p1', 'p2'])),
      // Round 1 fired before p4 joined; round 2 after.
      { event_key: 'round_start:swiss:1', event: 'round_start', payload: { event: 'round_start', stage: 'swiss', round: 1 }, ops: ['p1', 'p2'].map((p) => grant('coins', p, 'weekly:round_start:swiss:1')) },
      { event_key: 'round_start:swiss:2', event: 'round_start', payload: { event: 'round_start', stage: 'swiss', round: 2 }, ops: ['p1', 'p2', 'p4'].map((p) => grant('coins', p, 'weekly:round_start:swiss:2')) },
    ];

    const [late] = buildLateJoiners(ctx, events, NAMES, admin);

    expect(late.player.id).toBe('p4');
    expect(late.missed.map((event) => `${event.event}:${event.round ?? '-'}`)).toEqual(['stage_start:-', 'round_start:1']);
  });

  it('reads only the roster of the stage the event belongs to', () => {
    const ctx = league({ swiss: ['p1', 'p2'], finals: ['p5', 'p6'] });
    expect(buildLateJoiners(ctx, [stageStart(stageStartOps(['p1']))], NAMES, admin).map((entry) => entry.player.id)).toEqual(['p2']);
  });

  it('counts an effect only when its op is in the log (a rule whose condition was false left none)', () => {
    const ctx = league({ swiss: ['p1', 'p2', 'p3'] });
    // Only the points were applied for p1 and p2.
    const ops = ['p1', 'p2'].map((p) => points(p, 'welcome (stage_start:swiss)'));

    const result = buildLateJoiners(ctx, [stageStart(ops)], NAMES, admin);

    expect(missedKinds(result, 'p3')).toEqual(['adjust_points']);
  });

  it('ignores an event whose log holds no op for a player, and rows that are not one-time events', () => {
    const ctx = league({ swiss: ['p1', 'p2'] });
    const events: FiredEventRecord[] = [
      stageStart([]),
      { event_key: 'match_completed:m1', event: 'match_completed', payload: { event: 'match_completed', stage: 'swiss' }, ops: stageStartOps(['p1']) },
      { event_key: 'stage_start:swiss', event: 'stage_start', payload: 'not an object', ops: stageStartOps(['p1']) },
      { event_key: 'stage_start:other', event: 'stage_start', payload: { event: 'stage_start', stage: 'swiss' }, ops: stageStartOps(['p1']) },
    ];
    expect(buildLateJoiners(ctx, events, NAMES, admin)).toEqual([]);
  });

  it('leaves out an exclusive item (one holder by design) and an effect aimed at a filtered or named set of players', () => {
    const ctx = league({ swiss: ['p1', 'p2', 'p3'] });
    ctx.def = def({
      rules: [
        {
          kind: 'rule.on_event',
          id: 'welcome',
          on: { event: 'stage_start', stage: 'swiss' },
          effects: [
            { effect: 'grant_resource', resource: 'relic', to: everyone, amount: 1, item: 'mew' },
            { effect: 'grant_resource', resource: 'coins', to: { who: 'all', where: { k: 'bool', v: true } }, amount: 1 },
            { effect: 'grant_resource', resource: 'coins', to: { who: 'event_players' }, amount: 1 },
          ],
        },
      ],
      resources: [
        { key: 'relic', label: text('Relic'), holds: { kind: 'domain', domain: 'pool' }, visibility: 'all', exclusive: 'global' },
        { key: 'coins', label: text('Coins'), holds: { kind: 'counter' }, visibility: 'all', exclusive: 'none' },
      ],
    } as Partial<LateJoinerContext['def']>);
    const ops = [grant('relic', 'p1', 'welcome:stage_start:swiss'), grant('coins', 'p1', 'welcome:stage_start:swiss')];

    // The `event_players` grant is roster-wide here (the stage start names no players) and p1 got it; p2 and p3 missed it.
    const result = buildLateJoiners(ctx, [stageStart(ops)], NAMES, admin);

    expect(result.map((entry) => entry.player.id)).toEqual(['p2', 'p3']);
    expect(missedKinds(result, 'p2')).toEqual(['grant_resource']);
  });

  it('does not list an attribute the player already holds, and drops a player with nothing left', () => {
    const ctx = league({ swiss: ['p1', 'p2'] }, { attrs: { p2: { mood: 'calm' } } });
    ctx.def = def({
      rules: [{ kind: 'rule.on_event', id: 'welcome', on: { event: 'stage_start', stage: 'swiss' }, effects: [{ effect: 'set_attr', attr: 'mood', to: everyone, value: 'calm' }] }],
    } as Partial<LateJoinerContext['def']>);
    const ops: Json[] = [{ op: 'set_attr', player_id: 'p1', attr: 'mood', value: 'calm', source: 'event' }];

    expect(buildLateJoiners(ctx, [stageStart(ops)], NAMES, admin)).toEqual([]);
  });

  it('uses the whole league as the roster of an event that names no stage', () => {
    const ctx = league({ swiss: ['p1', 'p2'], finals: ['p3'] });
    ctx.def = def({
      rules: [{ kind: 'rule.on_event', id: 'lockdown', on: { event: 'action_locked', action: 'gift' }, effects: [{ effect: 'adjust_points', stage: 'swiss', to: everyone, points: 1 }] }],
    } as Partial<LateJoinerContext['def']>);
    const event: FiredEventRecord = {
      event_key: 'action_locked:gift',
      event: 'action_locked',
      payload: { event: 'action_locked', action: 'gift' },
      ops: [points('p1', 'lockdown (action_locked:gift)')],
    };

    const result = buildLateJoiners(ctx, [event], NAMES, admin);

    expect(result.map((entry) => entry.player.id)).toEqual(['p2', 'p3']);
    expect(result[0].missed[0]).toMatchObject({ event: 'action_locked', action: 'gift', stage: null, stage_label: null });
  });

  it('names a player the league does not know as a former player (name null) and sorts by name, then id', () => {
    const ctx = league({ swiss: ['p1', 'p2', 'p9', 'p3'] });
    const names = new Map([['p2', 'Zed'], ['p3', 'Amy']]);

    const result = buildLateJoiners(ctx, [stageStart(stageStartOps(['p1']))], names, admin);

    expect(result.map((entry) => entry.player)).toEqual([
      { id: 'p9', name: null },
      { id: 'p3', name: 'Amy' },
      { id: 'p2', name: 'Zed' },
    ]);
  });
});

describe('the masks of the late joiner list', () => {
  const ctx = (): LateJoinerContext => league({ swiss: ['p1', 'p2', 'p3', 'p4'] });
  const log = [stageStart(stageStartOps(['p1', 'p2', 'p3']))];

  it('an admin who does not play sees every missed effect of a late player', () => {
    expect(missedKinds(buildLateJoiners(ctx(), log, NAMES, { id: 'admin-1', plays: false }), 'p4')).toEqual([
      'grant_resource',
      'grant_resource',
      'adjust_points',
      'set_attr',
      'generate_relation',
    ]);
  });

  it('an admin who plays does not learn another player\'s holdings of a private resource, an attribute or a hidden draw', () => {
    const result = buildLateJoiners(ctx(), log, NAMES, { id: 'p1', plays: true });

    const keys = result.find((entry) => entry.player.id === 'p4')?.missed[0].effects.map((effect) => `${effect.kind}:${effect.key}`);
    // The public resource and the points stay; the private resource, the attribute and the draw of the hidden relation go.
    expect(keys).toEqual(['grant_resource:coins', 'adjust_points:swiss']);
    expect(JSON.stringify(result)).not.toMatch(/secret_coins|mood|santa/);
  });

  it('a late player who is the viewer sees their own misses whole', () => {
    const result = buildLateJoiners(ctx(), log, NAMES, { id: 'p4', plays: true });
    expect(missedKinds(result, 'p4')).toHaveLength(5);
  });

  it('shows the draw of a relation that hides nothing, or that is revealed', () => {
    const open = ctx();
    open.def = def({ relations: [{ key: 'santa', label: text('Santa'), shape: 'derangement', visibility: { from: 'all', to: 'all' } }] } as Partial<LateJoinerContext['def']>);
    expect(missedKinds(buildLateJoiners(open, log, NAMES, { id: 'p1', plays: true }), 'p4')).toContain('generate_relation');

    const revealed = ctx();
    revealed.state = { links: [link('p1', 'p2', 'santa', true), link('p2', 'p3', 'santa', true), link('p3', 'p1', 'santa', true)], attrs: {} };
    expect(missedKinds(buildLateJoiners(revealed, log, NAMES, { id: 'p1', plays: true }), 'p4')).toContain('generate_relation');
  });

  it('drops a player with nothing left after the masks', () => {
    const only = ctx();
    only.def = def({
      rules: [{ kind: 'rule.on_event', id: 'welcome', on: { event: 'stage_start', stage: 'swiss' }, effects: [{ effect: 'generate_relation', relation: 'santa' }] }],
    } as Partial<LateJoinerContext['def']>);
    const ops: Json[] = [{ op: 'set_relation', relation: 'santa', links: [{ from: 'p1', to: 'p2' }, { from: 'p2', to: 'p3' }, { from: 'p3', to: 'p1' }] }];

    expect(buildLateJoiners(only, [stageStart(ops)], NAMES, { id: 'p1', plays: true })).toEqual([]);
    expect(buildLateJoiners(only, [stageStart(ops)], NAMES, { id: 'admin-1', plays: false }).map((entry) => entry.player.id)).toEqual(['p4']);
  });
});

describe('buildLateJoiners after a substitution', () => {
  const seatMoved = (from: string, to: string): FiredEventRecord => ({
    event_key: `seat_moved:${from}-${to}`,
    event: 'seat_moved',
    payload: { from, to, rows: 4 },
    ops: [],
  });

  it('does not list the substitute: the seat already got what the event made for the player who left', () => {
    // p3 left, p4 holds the seat now (p4 is on the roster, p3 is not); the event named p3.
    const ctx = league({ swiss: ['p1', 'p2', 'p4'] });
    const log = [stageStart(stageStartOps(['p1', 'p2', 'p3'])), seatMoved('p3', 'p4')];

    expect(buildLateJoiners(ctx, log, NAMES, admin)).toEqual([]);
  });

  it('follows a chain of substitutions to the player who holds the seat now', () => {
    const ctx = league({ swiss: ['p1', 'p2', 'p5'] });
    const log = [stageStart(stageStartOps(['p1', 'p2', 'p3'])), seatMoved('p3', 'p4'), seatMoved('p4', 'p5')];

    expect(buildLateJoiners(ctx, log, NAMES, admin)).toEqual([]);
  });

  it('still lists a real late joiner next to the substitute', () => {
    const ctx = league({ swiss: ['p1', 'p2', 'p4', 'p6'] });
    const log = [stageStart(stageStartOps(['p1', 'p2', 'p3'])), seatMoved('p3', 'p4')];

    expect(buildLateJoiners(ctx, log, NAMES, admin).map((entry) => entry.player.id)).toEqual(['p6']);
  });

  it('lists a substitute for an event that fired after the move (the event named the holder, nobody else)', () => {
    const ctx = league({ swiss: ['p1', 'p2', 'p4', 'p6'] });
    // the move comes first in the log, so the later event's ops name the holder p4 already
    const log = [seatMoved('p3', 'p4'), stageStart(stageStartOps(['p1', 'p2', 'p4']))];

    expect(buildLateJoiners(ctx, log, NAMES, admin).map((entry) => entry.player.id)).toEqual(['p6']);
  });

  it('ignores a seat_moved row it cannot read', () => {
    const ctx = league({ swiss: ['p1', 'p2', 'p4'] });
    const broken: FiredEventRecord = { event_key: 'seat_moved:x', event: 'seat_moved', payload: { from: 3 }, ops: [] };

    expect(buildLateJoiners(ctx, [stageStart(stageStartOps(['p1', 'p2', 'p3'])), broken], NAMES, admin).map((entry) => entry.player.id)).toEqual(['p4']);
  });
});

describe('kitEventOfRecord', () => {
  it('reads the payload fire.ts writes, and refuses anything else', () => {
    expect(kitEventOfRecord({ payload: { event: 'round_end', stage: 'swiss', round: 3 } })).toEqual({ event: 'round_end', stage: 'swiss', round: 3 });
    expect(kitEventOfRecord({ payload: { event: 'time', stage: 'swiss', mark: 'kickoff' } })).toEqual({ event: 'time', stage: 'swiss', mark: 'kickoff' });
    for (const payload of [null, 'x', [], { event: 'something_else' }, {}]) expect(kitEventOfRecord({ payload: payload as Json })).toBeNull();
  });
});

describe('the late joiners in the admin overview', () => {
  function kitContext(members: string[]): KitContext {
    const real = giftDef();
    const rules = [
      ...real.rules,
      {
        kind: 'rule.on_event' as const,
        id: 'welcome',
        on: { event: 'stage_start' as const, stage: real.stages[0].key },
        effects: [{ effect: 'adjust_points' as const, stage: real.stages[0].key, to: { who: 'all' as const }, points: 1 }],
      },
    ];
    const formatDef = { ...real, rules };
    return {
      seasonId: 's-1',
      seed: SEED,
      revision: 1,
      def: formatDef,
      state: stateFor(formatDef, { links: [link('p1', 'p2'), link('p2', 'p3'), link('p3', 'p1')] }),
      tunableIssues: [],
      phases: [{ id: 'phase-1', stage: formatDef.stages[0], members }],
    };
  }
  const stageKey = giftDef().stages[0].key;
  const log: FiredEventRecord[] = [
    {
      event_key: `stage_start:${stageKey}`,
      event: 'stage_start',
      payload: { event: 'stage_start', stage: stageKey },
      ops: ['p1', 'p2', 'p3'].map((p): Json => ({ op: 'adjust_points', stage: stageKey, player_id: p, points: 1, reason: `welcome (stage_start:${stageKey})` })),
    },
  ];

  it('carries the list, from the events the loader read', () => {
    const overview = buildAdminOverview(kitContext(['p1', 'p2', 'p3', 'p4']), 'admin-1', NAMES, { openChallenges: 0, events: log });
    expect(overview.late_joiners.map((entry) => entry.player.id)).toEqual(['p4']);
    expect(overview.late_joiners[0].missed[0]).toMatchObject({ event: 'stage_start', stage: stageKey });
  });

  it('is empty when no events were read, and for a league that runs no format', () => {
    expect(buildAdminOverview(kitContext(['p1', 'p2', 'p3', 'p4']), 'admin-1', NAMES, { openChallenges: 0 }).late_joiners).toEqual([]);
    expect(NOT_RUNNING_OVERVIEW.late_joiners).toEqual([]);
  });

  it('applies the masks to an admin who also plays (the viewer is enrolled)', () => {
    // p1 is enrolled and an admin: points are public standings data, so the entry stays; nothing private is added.
    const overview = buildAdminOverview(kitContext(['p1', 'p2', 'p3', 'p4']), 'p1', NAMES, { openChallenges: 0, events: log });
    expect(JSON.stringify(overview.late_joiners)).not.toMatch(/santa|secret/);
    expect(overview.late_joiners.map((entry) => entry.player.id)).toEqual(['p4']);
  });
});
