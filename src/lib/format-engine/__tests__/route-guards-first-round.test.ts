/**
 * The first-round guard of the round routes: a kit phase waits for the format's own set-up (an undrawn relation an action
 * runs via, an unresolved missed-action check) and a league admin may start anyway with a logged force.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-studio/attach', () => ({ assertSeasonFormatAttached: vi.fn() }));
vi.mock('@/lib/format-engine/load', () => ({ loadKitPhase: vi.fn() }));
vi.mock('@/lib/format-engine/pairing-server', () => ({ openForbiddenPairingCheck: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/calendar-server', () => ({ fillRoundDeadline: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onRoundGenerated: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-end-server', () => ({ assertStageNotEnded: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format-engine/runtime/load')>()),
  loadFreshKitContext: vi.fn(),
}));

import { logAuditEvent } from '@/lib/audit/log';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { KitPhase } from '@/lib/format-engine/load';
import { loadFreshKitContext, type KitContext } from '@/lib/format-engine/runtime/load';
import { emptyRuntimeState, type RuntimeCheck } from '@/lib/format-engine/runtime/types';
import { onRoundGenerated } from '@/lib/format-engine/runtime/hooks';
import { announceKitRound, assertPhaseReadyForFirstRound, firstRoundGap, wantsForcedStart } from '../route-guards';

const SEASON = 's-1';
const tournament = (over: Record<string, unknown> = {}) =>
  ({ id: 't-1', season_id: SEASON, season_format_type: 'custom', current_round: 0, ...over }) as never;
const kitPhase = (engine: KitPhase['engine'] = 'kit') => ({ engine, stage: { key: 'cup' } }) as KitPhase;
const actor = { id: 'admin-1', name: 'Admin' };

const action = (via?: string) => ({ kind: 'player.action', id: 'choose_gifts', ...(via === undefined ? {} : { via }) });

const missed = (over: Record<string, unknown> = {}, status: RuntimeCheck['status'] = 'open'): RuntimeCheck => ({
  id: 'c-1',
  source: 'deadline_missed',
  rule_id: 'deadline:cup:0',
  dedupe_key: 'deadline:cup:0:choose_gifts:p1',
  subject: { applies: 'action', action: 'choose_gifts', player_id: 'p1', ...over } as never,
  status,
  note: null,
});

function context(
  opts: { rules?: unknown[]; members?: string[]; links?: KitContext['state']['links']; checks?: RuntimeCheck[]; relations?: unknown[]; fired?: string[] } = {},
): KitContext {
  return {
    seasonId: SEASON,
    seed: 'seed',
    def: { rules: opts.rules ?? [action('santa')], relations: opts.relations ?? [] },
    state: { ...emptyRuntimeState(), links: opts.links ?? [], checks: opts.checks ?? [], firedEventKeys: opts.fired ?? [] },
    tunableIssues: [],
    phases: [{ id: 'ph-1', stage: { key: 'cup' }, members: opts.members ?? ['p1', 'p2', 'p3'] }],
  } as unknown as KitContext;
}

const link = (from: string, to: string) => ({ relation: 'santa', from, to, revealed: false });
const cycle = [link('p1', 'p2'), link('p2', 'p3'), link('p3', 'p1')];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadFreshKitContext).mockResolvedValue(context());
});

describe('firstRoundGap', () => {
  it('reports an undrawn relation an action runs via', () => {
    expect(firstRoundGap(context())).toEqual({ reasons: ['relation_undrawn'], undrawn: ['santa'], openChecks: 0 });
  });

  it('is clear once the relation has a link', () => {
    expect(firstRoundGap(context({ links: cycle })).reasons).toEqual([]);
  });

  it('reports a relation whose draw left an enrolled player out (enrolled after the draw)', () => {
    const late = context({ links: cycle, members: ['p1', 'p2', 'p3', 'p4'] });
    expect(firstRoundGap(late)).toEqual({ reasons: ['relation_undrawn'], undrawn: ['santa'], openChecks: 0 });
    // A player who is only a recipient (or only a giver) is covered.
    expect(firstRoundGap(context({ links: [link('p1', 'p2'), link('p2', 'p3')] })).reasons).toEqual([]);
    // Links of another relation do not cover the player.
    const other = { relation: 'other', from: 'p4', to: 'p1', revealed: false };
    expect(firstRoundGap(context({ links: [...cycle, other], members: ['p1', 'p2', 'p3', 'p4'] })).undrawn).toEqual(['santa']);
  });

  it('does not let a pending draw cover the player an earlier draw missed (the draw is a no-op over existing links)', () => {
    const kickoff = { kind: 'rule.on_event', id: 'kickoff', on: { event: 'stage_start' }, effects: [{ effect: 'generate_relation', relation: 'santa' }] };
    const rules = [action('santa'), kickoff];
    const relations = [{ key: 'santa', shape: 'derangement' }];
    const late = context({ rules, relations, links: cycle, members: ['p1', 'p2', 'p3', 'p4'] });
    expect(firstRoundGap(late, { stage: 'cup', startsPhase: true })).toEqual({ reasons: ['relation_undrawn'], undrawn: ['santa'], openChecks: 0 });
    // Every enrolled player covered by the old links: nothing to wait for.
    expect(firstRoundGap(context({ rules, relations, links: cycle }), { stage: 'cup', startsPhase: true }).reasons).toEqual([]);
    // No link at all: the pending draw still covers the relation.
    expect(firstRoundGap(context({ rules, relations, members: ['p1', 'p2', 'p3', 'p4'] }), { stage: 'cup', startsPhase: true }).undrawn).toEqual([]);
  });

  it('needs at least two players before an undrawn relation counts', () => {
    expect(firstRoundGap(context({ members: ['p1'] })).reasons).toEqual([]);
    expect(firstRoundGap(context({ members: [] })).reasons).toEqual([]);
  });

  it('ignores an action without a via relation', () => {
    expect(firstRoundGap(context({ rules: [action()] })).reasons).toEqual([]);
  });

  it('lists each undrawn relation once, in key order', () => {
    const rules = [action('zeta'), { ...action('alpha'), id: 'second' }, { ...action('zeta'), id: 'third' }];
    expect(firstRoundGap(context({ rules })).undrawn).toEqual(['alpha', 'zeta']);
  });

  it('counts open deadline_missed checks of an action policy only', () => {
    const checks = [
      missed(),
      missed({ player_id: 'p2' }),
      missed({}, 'confirmed'),
      missed({}, 'rejected'),
      missed({ applies: 'match', action: undefined }),
      { ...missed(), source: 'team_audit' } as RuntimeCheck,
      { ...missed(), subject: null as never },
    ];
    const gap = firstRoundGap(context({ links: cycle, checks }));
    expect(gap).toEqual({ reasons: ['action_incomplete'], undrawn: [], openChecks: 2 });
  });

  it('reports both reasons, undrawn first', () => {
    expect(firstRoundGap(context({ checks: [missed()] })).reasons).toEqual(['relation_undrawn', 'action_incomplete']);
  });

  describe('a relation drawn by an effect right after the first round', () => {
    const draw = (on: unknown, extra: Record<string, unknown> = {}, relation = 'santa') => ({
      kind: 'rule.on_event',
      id: 'kickoff',
      on,
      effects: [{ effect: 'generate_relation', relation }],
      ...extra,
    });
    const santa = { key: 'santa', shape: 'derangement' };
    const start = { stage: 'cup', startsPhase: true };
    const gap = (rules: unknown[], over: Parameters<typeof context>[0] = {}, startArg: Parameters<typeof firstRoundGap>[1] = start) =>
      firstRoundGap(context({ rules: [action('santa'), ...rules], relations: [santa], ...over }), startArg);

    it('is not undrawn when a stage_start rule draws it and the round starts the phase', () => {
      expect(gap([draw({ event: 'stage_start', stage: 'cup' })]).reasons).toEqual([]);
      expect(gap([draw({ event: 'stage_start' })]).reasons).toEqual([]);
    });

    it('is not undrawn when a round_start rule draws it for round 1 (or for any round)', () => {
      expect(gap([draw({ event: 'round_start', stage: 'cup', round: 1 })]).reasons).toEqual([]);
      expect(gap([draw({ event: 'round_start' })], {}, { stage: 'cup', startsPhase: false }).reasons).toEqual([]);
    });

    it('stays undrawn without the start argument (the plain read of the state)', () => {
      expect(firstRoundGap(context({ rules: [action('santa'), draw({ event: 'stage_start' })], relations: [santa] })).undrawn).toEqual(['santa']);
    });

    it('stays undrawn when the rule is for another stage or round, another relation, or a stage_start that will not fire', () => {
      expect(gap([draw({ event: 'stage_start', stage: 'other' })]).undrawn).toEqual(['santa']);
      expect(gap([draw({ event: 'round_start', stage: 'cup', round: 2 })]).undrawn).toEqual(['santa']);
      expect(gap([draw({ event: 'stage_start' }, {}, 'other')]).undrawn).toEqual(['santa']);
      expect(gap([draw({ event: 'stage_start' })], {}, { stage: 'cup', startsPhase: false }).undrawn).toEqual(['santa']);
      expect(gap([draw({ event: 'stage_start' })], { fired: ['stage_start:cup'] }).undrawn).toEqual(['santa']);
    });

    it('stays undrawn for a manual relation (the effect cannot draw it) or when the rule condition is false', () => {
      expect(gap([draw({ event: 'stage_start' })], { relations: [{ key: 'santa', shape: 'manual' }] }).undrawn).toEqual(['santa']);
      expect(gap([draw({ event: 'stage_start' }, { when: { k: 'bool', v: false } })]).undrawn).toEqual(['santa']);
      expect(gap([draw({ event: 'stage_start' }, { when: { k: 'bool', v: true } })]).undrawn).toEqual([]);
    });

    it('still reports the open action checks', () => {
      expect(gap([draw({ event: 'stage_start' })], { checks: [missed()] })).toEqual({ reasons: ['action_incomplete'], undrawn: [], openChecks: 1 });
    });
  });
});

describe('assertPhaseReadyForFirstRound', () => {
  const run = (over: { tournament?: unknown; phase?: KitPhase | null; force?: boolean } = {}) =>
    assertPhaseReadyForFirstRound(
      (over.tournament ?? tournament()) as never,
      over.phase === undefined ? kitPhase() : over.phase,
      { force: over.force, actor },
    );

  it('refuses with 409 format_not_ready and lists the reasons', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ checks: [missed()] }));
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    const refused = error as UserFacingError;
    expect(refused.code).toBe('format_not_ready');
    expect(refused.statusCode).toBe(409);
    expect(refused.params).toEqual({ reasons: 'relation_undrawn,action_incomplete', open_checks: 1, undrawn: 1 });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('passes when the format has nothing to wait for', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ rules: [] }));
    await expect(run()).resolves.toBeNull();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('passes a first round whose relation the stage_start of the new phase draws', async () => {
    const kickoff = { kind: 'rule.on_event', id: 'kickoff', on: { event: 'stage_start', stage: 'cup' }, effects: [{ effect: 'generate_relation', relation: 'santa' }] };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ rules: [action('santa'), kickoff], relations: [{ key: 'santa', shape: 'derangement' }] }));
    await expect(run({ tournament: tournament({ status: 'upcoming' }) })).resolves.toBeNull();
    // An active phase fired its stage_start already: nothing will draw after this round.
    await expect(run({ tournament: tournament({ status: 'active' }) })).rejects.toMatchObject({ code: 'format_not_ready' });
  });

  it('refuses a new phase whose pending draw would be a no-op over old links that miss a player, unless forced', async () => {
    const kickoff = { kind: 'rule.on_event', id: 'kickoff', on: { event: 'stage_start', stage: 'cup' }, effects: [{ effect: 'generate_relation', relation: 'santa' }] };
    vi.mocked(loadFreshKitContext).mockResolvedValue(
      context({ rules: [action('santa'), kickoff], relations: [{ key: 'santa', shape: 'derangement' }], links: cycle, members: ['p1', 'p2', 'p3', 'p4'] }),
    );
    const upcoming = tournament({ status: 'upcoming' });
    await expect(run({ tournament: upcoming })).rejects.toMatchObject({ code: 'format_not_ready', params: { reasons: 'relation_undrawn', undrawn: 1 } });
    await expect(run({ tournament: upcoming, force: true })).resolves.toMatchObject({ gap: { reasons: ['relation_undrawn'], undrawn: ['santa'] } });
  });

  it('returns the override of a forced start and writes no audit row itself', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ checks: [missed(), missed({ player_id: 'p2' })] }));
    const forced = await run({ force: true });
    expect(forced).toMatchObject({ tournamentId: 't-1', seasonId: SEASON, actor, gap: { reasons: ['relation_undrawn', 'action_incomplete'], undrawn: ['santa'], openChecks: 2 } });
    // The route can still refuse the request (too few players, groups forming, a pairing error): no round was forced yet.
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('audits the forced start once the round is announced, with the reasons it overrode', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ checks: [missed(), missed({ player_id: 'p2' })] }));
    const forced = await run({ force: true });
    await announceKitRound(tournament(), kitPhase(), { roundNumber: 1 }, true, forced);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(onRoundGenerated).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'admin-1',
      actor_name: 'Admin',
      action: 'season.format.round.force_start',
      resource_type: 'tournament',
      resource_id: 't-1',
      metadata: { season_id: SEASON, reasons: ['relation_undrawn', 'action_incomplete'], relations: ['santa'], open_checks: 2 },
    });
  });

  it('returns nothing for a forced start that overrode nothing, so no audit row follows', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ rules: [] }));
    const forced = await run({ force: true });
    expect(forced).toBeNull();
    await announceKitRound(tournament(), kitPhase(), { roundNumber: 1 }, true, forced);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('writes no audit row for a later round or a phase that is not on the kit engine', async () => {
    await announceKitRound(tournament(), kitPhase('shadow'), { roundNumber: 1 }, true, {
      tournamentId: 't-1',
      seasonId: SEASON,
      actor,
      gap: { reasons: ['relation_undrawn'], undrawn: ['santa'], openChecks: 0 },
    });
    expect(logAuditEvent).not.toHaveBeenCalled();
    await announceKitRound(tournament(), kitPhase(), { roundNumber: 2 }, false, null);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('does not read the runtime for a phase that already has a round', async () => {
    await expect(run({ tournament: tournament({ current_round: 1 }) })).resolves.toBeNull();
    expect(loadFreshKitContext).not.toHaveBeenCalled();
  });

  it.each([
    ['no kit phase', null],
    ['a shadow phase', kitPhase('shadow')],
  ])('leaves %s alone', async (_label, phase) => {
    await expect(run({ phase })).resolves.toBeNull();
    expect(loadFreshKitContext).not.toHaveBeenCalled();
  });

  it('leaves a tournament that is not a phase of a custom league alone', async () => {
    await expect(run({ tournament: tournament({ season_format_type: 'singles' }) })).resolves.toBeNull();
    await expect(run({ tournament: tournament({ season_id: null }) })).resolves.toBeNull();
    expect(loadFreshKitContext).not.toHaveBeenCalled();
  });

  it('passes when the league is not on the kit engine (no context)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await expect(run()).resolves.toBeNull();
  });
});

describe('wantsForcedStart', () => {
  const at = (url: string) => ({ url }) as unknown as NextRequest;

  it('is true only for force=true in the query', () => {
    expect(wantsForcedStart(at('https://example.test/api/generate-round/x?force=true'))).toBe(true);
    expect(wantsForcedStart(at('https://example.test/api/generate-round/x?a=1&force=true'))).toBe(true);
  });

  it.each(['force=1', 'force=false', 'force=', 'Force=true', 'forced=true'])('is false for %s', (query) => {
    expect(wantsForcedStart(at(`https://example.test/api/generate-round/x?${query}`))).toBe(false);
  });

  it('is false without a query or with an unreadable url', () => {
    expect(wantsForcedStart(at('https://example.test/api/generate-round/x'))).toBe(false);
    expect(wantsForcedStart(at('not a url'))).toBe(false);
    expect(wantsForcedStart({} as NextRequest)).toBe(false);
  });
});
