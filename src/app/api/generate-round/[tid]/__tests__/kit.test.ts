/**
 * The kit branch of POST /api/generate-round/[tid]: a phase of a custom league whose attached format runs on the
 * kit pairs by its own stage (Swiss rounds cap and rematch notice, round robin legs); shadow keeps the legacy pairing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
  updateTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(), updateSeason: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
  createRoundWithMatches: vi.fn(),
  addMatchesToRound: vi.fn(),
  updateRoundStatus: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getCompletedMatchRecords: vi.fn(),
  getPairedMatchRecords: vi.fn(),
  getMatchesByTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
  createGroupBatch: vi.fn(),
  deleteGroupsByTournament: vi.fn(),
  addGroupMembersBatch: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroups: vi.fn(), seasonHasGroups: vi.fn() }));
vi.mock('@/lib/tournament', () => ({ generateRound: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));
vi.mock('@/lib/ai/trigger', () => ({ triggerTournamentReport: vi.fn() }));
vi.mock('@/lib/feature-flags', () => ({ ENABLE_KALE_CABBAGE: false }));
vi.mock('@/lib/format-studio/attach', () => ({ assertSeasonFormatAttached: vi.fn() }));
vi.mock('@/lib/format-engine/load', () => ({ loadKitPhase: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onRoundGenerated: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format-engine/runtime/load')>()),
  loadFreshKitContext: vi.fn(),
}));

import { POST } from '@/app/api/generate-round/[tid]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { addMatchesToRound, createRoundWithMatches, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { writtenBatches } from '@/test/round-writes';
import {
  getCompletedMatchRecords,
  getMatchesByTournament,
  getPairedMatchRecords,
} from '@/lib/supabase/queries/matches';
import { addGroupMembersBatch, createGroupBatch, getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getSeasonGroups, seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { generateRound } from '@/lib/tournament';
import { logAuditEvent } from '@/lib/audit/log';
import { loadKitPhase, type KitPhase } from '@/lib/format-engine/load';
import { onRoundGenerated } from '@/lib/format-engine/runtime/hooks';
import { loadFreshKitContext } from '@/lib/format-engine/runtime/load';
import { generateRoundRobinRound } from '@/lib/tournament/round-robin';
import type { Pairing, Stage } from '@/lib/format-kit/types';

const TID = 'ae13bc20-d43b-42b5-8de0-4944cb4025e3';
const routeParams = { params: Promise.resolve({ tid: TID }) };
const request = {} as NextRequest;
const forced = { url: 'https://example.test/api/generate-round/x?force=true' } as NextRequest;

/** A league whose action runs via the `santa` relation, drawn or not, with the checks the admin left open. */
function santaContext(opts: { drawn?: boolean; openChecks?: number } = {}) {
  const links = opts.drawn === true ? ['p1', 'p2', 'p3', 'p4'].map((from, i, all) => ({ relation: 'santa', from, to: all[(i + 1) % all.length], revealed: false })) : [];
  const checks = Array.from({ length: opts.openChecks ?? 0 }, (_, i) => ({
    id: `c-${i}`,
    source: 'deadline_missed',
    rule_id: 'deadline:cup:0',
    dedupe_key: `deadline:cup:0:choose_gifts:p${i}`,
    subject: { applies: 'action', action: 'choose_gifts', player_id: `p${i}` },
    status: 'open',
    note: null,
  }));
  return {
    def: { rules: [{ kind: 'player.action', id: 'choose_gifts', via: 'santa' }] },
    state: { links, checks },
    phases: [{ id: 'ph-1', stage: { key: 'cup' }, members: ['p1', 'p2', 'p3', 'p4'] }],
  } as never;
}
const PLAYERS = ['p1', 'p2', 'p3', 'p4'];

function stage(pairing: Pairing): Stage {
  return {
    key: 'main',
    name: { en: { v: 'Main', s: 'human' }, base: 'en' },
    participants: { from: 'roster', seeding: 'signup' },
    pairing,
    series: { best_of: 1, allow_draw: false, overrides: [] },
    ruleset: { kind: 'season_default' },
    doubles: false,
    players_per_match: 2,
    scoring: { win: 3, loss: 0, bye: 3 },
    rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }],
    columns: [],
  };
}

function phase(pairing: Pairing, engine: KitPhase['engine'] = 'kit'): KitPhase {
  return { engine, seed: 'seed-0123456789', stage: stage(pairing), outcomes: {}, tableExtras: {} };
}

const record = (p1: string, p2: string, winner: string | null, round: number) => ({
  player_1_id: p1,
  player_2_id: p2,
  winner_id: winner,
  round_number: round,
});

function tournament(bracket_type: 'swiss' | 'round_robin', current_round: number) {
  return {
    id: TID,
    name: 'Kit Cup',
    status: 'active',
    season_id: 's-1',
    season_format_type: 'custom',
    bracket_type,
    current_round,
    best_of_default: 1,
    bo_overrides: {},
  };
}

const batches = () => writtenBatches(vi.mocked(createRoundWithMatches), vi.mocked(addMatchesToRound));

function writtenPairs(): string[] {
  const inputs = batches()[0] ?? [];
  return inputs.map((m: { player_1_id: string; player_2_id: string }) => `${m.player_1_id}-${m.player_2_id}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
  vi.mocked(loadFreshKitContext).mockResolvedValue(null);
  vi.mocked(getParticipants).mockResolvedValue(PLAYERS.map((id) => ({ id, name: id.toUpperCase() })) as never);
  vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
  vi.mocked(getPairedMatchRecords).mockResolvedValue([] as never);
  vi.mocked(getGroupsByTournament).mockResolvedValue([] as never);
  vi.mocked(getSeasonGroups).mockResolvedValue([]);
  vi.mocked(getMatchesByTournament).mockResolvedValue([]);
  vi.mocked(createRoundWithMatches).mockImplementation(
    async (input: { name: string; round_number: number }) =>
      ({ id: `r-${input.round_number}`, tournament_id: TID, name: input.name, round_number: input.round_number, status: 'pending' }) as never,
  );
});

describe('generate-round on a kit phase', () => {
  it('pairs a Swiss round from the stage table, not the legacy generator', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('swiss', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed', bye_player_ids: [] }] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'swiss', rounds: 3, avoid_repeats: true }));
    const history = [record('p1', 'p2', 'p1', 1), record('p3', 'p4', 'p3', 1)];
    vi.mocked(getCompletedMatchRecords).mockResolvedValue(history as never);
    vi.mocked(getPairedMatchRecords).mockResolvedValue(history as never);

    const response = await POST(request, routeParams);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(generateRound).not.toHaveBeenCalled();
    const pairs = writtenPairs().map((pair) => pair.split('-').sort().join('-')).sort();
    expect(pairs).toEqual(['p1-p3', 'p2-p4']);
    expect(body.warnings).toBeUndefined();
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ engine: 'kit', rematches: 0 });
  });

  it('pairs by the table the public sees: point adjustments steer the pairing (tableExtras)', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('swiss', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed', bye_player_ids: [] }] as never);
    vi.mocked(loadKitPhase).mockResolvedValue({
      ...phase({ kind: 'swiss', rounds: 3, avoid_repeats: true }),
      tableExtras: { pointAdjustments: { p4: 10 } },
    });
    const history = [record('p1', 'p2', 'p1', 1), record('p3', 'p4', 'p3', 1)];
    vi.mocked(getCompletedMatchRecords).mockResolvedValue(history as never);
    vi.mocked(getPairedMatchRecords).mockResolvedValue(history as never);

    const response = await POST(request, routeParams);

    expect(response.status).toBe(201);
    // p4 is first with the adjustment and has met p3, so it meets p1; without the extras the pairs are p1-p3 and p2-p4.
    expect(writtenPairs().map((pair) => pair.split('-').sort().join('-')).sort()).toEqual(['p1-p4', 'p2-p3']);
  });

  it('stops after the stage rounds', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('swiss', 2) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed', bye_player_ids: [] },
      { round_number: 2, status: 'completed', bye_player_ids: [] },
    ] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'swiss', rounds: 2, avoid_repeats: true }));

    const response = await POST(request, routeParams);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('rounds_all_generated');
    expect(createRoundWithMatches).not.toHaveBeenCalled();
  });

  it('reports a rematch the search could not avoid', async () => {
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }] as never);
    vi.mocked(getTournamentById).mockResolvedValue(tournament('swiss', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed', bye_player_ids: [] }] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'swiss', rounds: 3, avoid_repeats: true }));
    const history = [record('p1', 'p2', 'p1', 1)];
    vi.mocked(getCompletedMatchRecords).mockResolvedValue(history as never);
    vi.mocked(getPairedMatchRecords).mockResolvedValue(history as never);

    const response = await POST(request, routeParams);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.warnings).toEqual([{ code: 'swiss_rematches', params: { count: 1 } }]);
    expect(onRoundGenerated).toHaveBeenCalledWith(expect.objectContaining({ roundNumber: 2, rematches: 1, startsPhase: false }));
  });

  it('tells the format runtime about the round, and the phase start for an upcoming phase', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...tournament('swiss', 0), status: 'upcoming' } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'swiss', rounds: 3, avoid_repeats: true }));

    const response = await POST(request, routeParams);

    expect(response.status).toBe(201);
    expect(onRoundGenerated).toHaveBeenCalledTimes(1);
    expect(onRoundGenerated).toHaveBeenCalledWith(expect.objectContaining({ roundNumber: 1, rematches: 0, startsPhase: true }));
  });

  it('does not call the format runtime for a shadow phase', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('swiss', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed', bye_player_ids: [] }] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'swiss', rounds: 3, avoid_repeats: true }, 'shadow'));
    vi.mocked(generateRound).mockReturnValue({ pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }], round_name: 'Round 2', bye_player_ids: [] } as never);

    await POST(request, routeParams);

    expect(onRoundGenerated).not.toHaveBeenCalled();
  });

  it('plays a second round robin leg with sides swapped, without a drift refusal', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 3) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue(
      [1, 2, 3].map((n) => ({ round_number: n, status: 'completed', bye_player_ids: [] })) as never,
    );
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'round_robin', legs: 2, mirror_legs: true }));
    const legOne = [1, 2, 3].flatMap((n) =>
      generateRoundRobinRound(PLAYERS, n).pairings.map((p) => record(p.player_1_id, p.player_2_id, p.player_1_id, n)),
    );
    vi.mocked(getPairedMatchRecords).mockResolvedValue(legOne as never);

    const response = await POST(request, routeParams);

    expect(response.status).toBe(201);
    const first = generateRoundRobinRound(PLAYERS, 1).pairings.map((p) => `${p.player_2_id}-${p.player_1_id}`);
    expect(writtenPairs()).toEqual(first);
  });

  it('refuses a round past the last leg', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 6) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'round_robin', legs: 2, mirror_legs: true }));

    const response = await POST(request, routeParams);

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('rounds_all_generated');
  });

  it('keeps the legacy pairing in shadow mode', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('swiss', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed', bye_player_ids: [] }] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'swiss', rounds: 3, avoid_repeats: true }, 'shadow'));
    vi.mocked(generateRound).mockReturnValue({
      pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
      round_name: 'Round 2',
      bye_player_ids: [],
    } as never);

    const response = await POST(request, routeParams);

    expect(response.status).toBe(201);
    expect(generateRound).toHaveBeenCalledTimes(1);
  });
  it('refuses to pair a manual stage: the admin pairs it by hand', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 0) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'manual' }));

    const response = await POST(request, routeParams);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('rounds_manual_pairing');
    expect(generateRound).not.toHaveBeenCalled();
    expect(createRoundWithMatches).not.toHaveBeenCalled();
  });

  it('forms the stage groups before the first round and pairs each group by itself', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 0) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(getParticipants).mockResolvedValue(PLAYERS.map((id, i) => ({ id, name: id.toUpperCase(), seed: i + 1 })) as never);
    const kitPhase = phase({ kind: 'round_robin', legs: 1, mirror_legs: true });
    kitPhase.stage.groups = { count: 2, method: 'serpentine' };
    vi.mocked(loadKitPhase).mockResolvedValue(kitPhase);
    vi.mocked(seasonHasGroups).mockResolvedValue(false);
    const formed = [
      { id: 'g1', group_number: 1, name: 'Group A', season_group_id: null, members: [{ player_id: 'p1', player_name: 'P1', seed: 1 }, { player_id: 'p4', player_name: 'P4', seed: 2 }] },
      { id: 'g2', group_number: 2, name: 'Group B', season_group_id: null, members: [{ player_id: 'p2', player_name: 'P2', seed: 1 }, { player_id: 'p3', player_name: 'P3', seed: 2 }] },
    ];
    vi.mocked(getGroupsByTournament).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue(formed as never);
    vi.mocked(createGroupBatch).mockResolvedValue([
      { id: 'g1', group_number: 1 },
      { id: 'g2', group_number: 2 },
    ] as never);

    const response = await POST(request, routeParams);

    expect(response.status).toBe(201);
    expect(createGroupBatch).toHaveBeenCalledWith([
      { tournament_id: TID, name: 'Group A', group_number: 1 },
      { tournament_id: TID, name: 'Group B', group_number: 2 },
    ]);
    expect(addGroupMembersBatch).toHaveBeenCalledWith([
      { group_id: 'g1', player_id: 'p1', seed: 1 },
      { group_id: 'g1', player_id: 'p4', seed: 2 },
      { group_id: 'g2', player_id: 'p2', seed: 1 },
      { group_id: 'g2', player_id: 'p3', seed: 2 },
    ]);
    expect(writtenPairs().map((pair) => pair.split('-').sort().join('-')).sort()).toEqual(['p1-p4', 'p2-p3']);
    expect(generateRound).not.toHaveBeenCalled();
  });

  it('answers 409 groups_forming_in_progress for groups another request has inserted but not filled yet', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 0) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(getParticipants).mockResolvedValue(PLAYERS.map((id, i) => ({ id, name: id.toUpperCase(), seed: i + 1 })) as never);
    const kitPhase = phase({ kind: 'round_robin', legs: 1, mirror_legs: true });
    kitPhase.stage.groups = { count: 2, method: 'serpentine' };
    vi.mocked(loadKitPhase).mockResolvedValue(kitPhase);
    vi.mocked(seasonHasGroups).mockResolvedValue(false);
    const now = new Date().toISOString();
    const empty = [
      { id: 'g1', group_number: 1, name: 'Group A', season_group_id: null, created_at: now, members: [] },
      { id: 'g2', group_number: 2, name: 'Group B', season_group_id: null, created_at: now, members: [] },
    ];
    vi.mocked(getGroupsByTournament).mockResolvedValue(empty as never);

    const response = await POST(request, routeParams);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('groups_forming_in_progress');
    expect(createRoundWithMatches).not.toHaveBeenCalled();
    expect(batches()).toEqual([]);
  });
});

describe('generate-round: groups that mirror league groups have no legs', () => {
  const mirrored = [
    { id: 'g1', group_number: 1, name: 'Group A', season_group_id: 'sg-1', members: [{ player_id: 'p1', player_name: 'P1', seed: 1 }, { player_id: 'p4', player_name: 'P4', seed: 2 }] },
    { id: 'g2', group_number: 2, name: 'Group B', season_group_id: 'sg-2', members: [{ player_id: 'p2', player_name: 'P2', seed: 1 }, { player_id: 'p3', player_name: 'P3', seed: 2 }] },
  ];

  beforeEach(() => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 0) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue(mirrored as never);
  });

  it('refuses a two-leg kit round robin with 409 rounds_mirrored_groups_legs instead of playing one leg', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'round_robin', legs: 2, mirror_legs: true }));

    const response = await POST(request, routeParams);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('rounds_mirrored_groups_legs');
    expect(body.params).toMatchObject({ legs: 2 });
    expect(createRoundWithMatches).not.toHaveBeenCalled();
    expect(batches()).toEqual([]);
  });

  it('still plays a single leg on the league week plan', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'round_robin', legs: 1, mirror_legs: true }));

    const response = await POST(request, routeParams);

    expect(response.status).not.toBe(409);
    expect(createRoundWithMatches).toHaveBeenCalled();
  });
});

describe('generate-round: the first round of a kit phase waits for the format set-up', () => {
  beforeEach(() => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('swiss', 0) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'swiss', rounds: 3, avoid_repeats: true }));
  });

  it('refuses with 409 format_not_ready while the relation is undrawn, before any round is written', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext({ openChecks: 2 }));

    const response = await POST(request, routeParams);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('format_not_ready');
    expect(body.params).toMatchObject({ reasons: 'relation_undrawn,action_incomplete', open_checks: 2 });
    expect(createRoundWithMatches).not.toHaveBeenCalled();
    expect(batches()).toEqual([]);
  });

  it('writes the round once the relation is drawn and no check is open', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext({ drawn: true }));

    expect((await POST(request, routeParams)).status).toBe(201);
    expect(createRoundWithMatches).toHaveBeenCalledTimes(1);
  });

  it('lets an admin start anyway with ?force=true and audits it', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext());

    expect((await POST(forced, routeParams)).status).toBe(201);

    expect(createRoundWithMatches).toHaveBeenCalledTimes(1);
    const actions = vi.mocked(logAuditEvent).mock.calls.map((call) => call[0].action);
    expect(actions).toContain('season.format.round.force_start');
    expect(vi.mocked(logAuditEvent).mock.calls.find((call) => call[0].action === 'season.format.round.force_start')?.[0]).toMatchObject({
      actor_id: 'admin-1',
      resource_id: TID,
      metadata: { reasons: ['relation_undrawn'], relations: ['santa'] },
    });
  });

  it('audits no forced start when the request is refused after the guard (too few players): no round was forced', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext());
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1', name: 'P1' }] as never);

    const response = await POST(forced, routeParams);

    expect(response.status).toBe(400);
    expect(createRoundWithMatches).not.toHaveBeenCalled();
    expect(vi.mocked(logAuditEvent).mock.calls.map((call) => call[0].action)).not.toContain('season.format.round.force_start');
  });

  it('does not look at a later round', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('swiss', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed', bye_player_ids: [] }] as never);
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext());

    expect((await POST(request, routeParams)).status).toBe(201);
    expect(loadFreshKitContext).not.toHaveBeenCalled();
  });
});

describe('generate-round on a stage that ends on an expression', () => {
  const exprEnd = { kind: 'expr', when: { k: 'bool', v: false } } as never;
  const rrPhase = (endWhen: unknown, engine: KitPhase['engine'] = 'kit') => {
    const kit = phase({ kind: 'round_robin', legs: 1, mirror_legs: true }, engine);
    kit.stage.end_when = endWhen as never;
    return kit;
  };
  const rrRound = (n: number, status: string) => ({ id: `r-${n}`, name: `Round ${n}`, round_number: n, status, bye_player_ids: [] });
  const matchOf = (n: number, status: string) => ({ id: `m-${n}-${status}`, round_id: `r-${n}`, status });

  it('refuses a round robin round while an earlier round has unfinished matches, so the condition is evaluated first', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([rrRound(1, 'active')] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([matchOf(1, 'completed'), matchOf(1, 'scheduled')] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(rrPhase(exprEnd));

    const response = await POST(request, routeParams);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('rounds_end_when_round_open');
    expect(body.params).toEqual({ round: 'Round 1' });
    expect(createRoundWithMatches).not.toHaveBeenCalled();
    expect(batches()).toEqual([]);
  });

  it('writes the next round once the earlier rounds are played and the condition does not end the stage', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([rrRound(1, 'active')] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([matchOf(1, 'completed'), matchOf(1, 'completed')] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(rrPhase(exprEnd));

    const response = await POST(request, routeParams);

    expect(response.status).toBe(201);
    expect(createRoundWithMatches).toHaveBeenCalledTimes(1);
  });

  it('reads the open-round guard before the stage-end check, so a match completed in between is seen by the check', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([rrRound(1, 'active')] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([matchOf(1, 'completed')] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(rrPhase(exprEnd));

    expect((await POST(request, routeParams)).status).toBe(201);

    // The stage-end check loads the format context; the guard's match read has to come first.
    const guardRead = vi.mocked(getMatchesByTournament).mock.invocationCallOrder[0];
    const endCheck = vi.mocked(loadFreshKitContext).mock.invocationCallOrder[0];
    expect(guardRead).toBeDefined();
    expect(endCheck).toBeDefined();
    expect(guardRead).toBeLessThan(endCheck);
  });

  it('refuses on the open round without running the stage-end check', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([rrRound(1, 'active')] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([matchOf(1, 'scheduled')] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(rrPhase(exprEnd));

    expect((await POST(request, routeParams)).status).toBe(409);
    expect(loadFreshKitContext).not.toHaveBeenCalled();
  });

  it('lets a round robin write rounds in advance when the stage ends on a rounds bound', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([rrRound(1, 'active')] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([matchOf(1, 'scheduled')] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(rrPhase({ kind: 'rounds', rounds: 3 }));

    expect((await POST(request, routeParams)).status).toBe(201);
  });

  it('leaves a phase off the kit engine alone', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('round_robin', 1) as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([rrRound(1, 'active')] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([matchOf(1, 'scheduled')] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(rrPhase(exprEnd, 'shadow'));
    vi.mocked(generateRound).mockReturnValue({ pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }], round_name: 'Round 2', bye_player_ids: [] } as never);

    expect((await POST(request, routeParams)).status).toBe(201);
  });
});
