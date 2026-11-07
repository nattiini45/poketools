/**
 * The kit branch of POST /api/tournaments/[id]/generate-all-rounds: a manual stage is refused, and a kit round
 * robin with its own groups plays every group as a round robin of the stage's legs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: vi.fn(), AuthError: class AuthError extends Error {} }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
  updateTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
  createRound: vi.fn(),
  updateRoundByePlayers: vi.fn(),
  updateRoundStatus: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  createMatchBatch: vi.fn(),
  getMatchesByTournament: vi.fn(),
  getPairedMatchRecords: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
  createGroupBatch: vi.fn(),
  deleteGroupsByTournament: vi.fn(),
  addGroupMembersBatch: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroups: vi.fn(), seasonHasGroups: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-studio/attach', () => ({ assertSeasonFormatAttached: vi.fn() }));
vi.mock('@/lib/format-engine/load', () => ({ loadKitPhase: vi.fn() }));
vi.mock('@/lib/format-engine/pairing-server', () => ({
  loadPairingAids: vi.fn(async () => ({})),
  openForbiddenPairingCheck: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format-engine/runtime/load')>()),
  loadFreshKitContext: vi.fn(),
}));

import { POST } from '@/app/api/tournaments/[id]/generate-all-rounds/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { createRound, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { createMatchBatch, getMatchesByTournament, getPairedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { loadKitPhase, type KitPhase } from '@/lib/format-engine/load';
import { loadFreshKitContext } from '@/lib/format-engine/runtime/load';
import { logAuditEvent } from '@/lib/audit/log';
import type { EndWhen, Pairing, Stage } from '@/lib/format-kit/types';

const ID = 'a5cb20ac-a127-482d-855d-d802e29185bc';
const routeParams = { params: Promise.resolve({ id: ID }) };
const forced = { url: 'https://example.test/api/tournaments/x/generate-all-rounds?force=true' } as NextRequest;

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

function phase(pairing: Pairing, endWhen?: EndWhen): KitPhase {
  const stage: Stage = {
    key: 'league',
    name: { en: { v: 'League', s: 'human' }, base: 'en' },
    participants: { from: 'roster', seeding: 'signup' },
    pairing,
    series: { best_of: 1, allow_draw: false, overrides: [] },
    ruleset: { kind: 'season_default' },
    doubles: false,
    players_per_match: 2,
    scoring: { win: 3, loss: 0, bye: 0 },
    rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }],
    columns: [],
    ...(endWhen === undefined ? {} : { end_when: endWhen }),
  };
  return { engine: 'kit', seed: 'seed-0123456789', stage, outcomes: {}, tableExtras: {} };
}

const group = (id: string, n: number, players: string[], seasonGroupId: string | null = null) => ({
  id,
  group_number: n,
  name: `Group ${n}`,
  season_group_id: seasonGroupId,
  members: players.map((player_id, i) => ({ player_id, player_name: player_id, seed: i + 1 })),
});

function written(): string[][] {
  return vi
    .mocked(createMatchBatch)
    .mock.calls.map((call) => call[0].map((m: { player_1_id: string; player_2_id: string }) => `${m.player_1_id}-${m.player_2_id}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
  vi.mocked(loadFreshKitContext).mockResolvedValue(null);
  vi.mocked(getTournamentById).mockResolvedValue({
    id: ID,
    name: 'League',
    bracket_type: 'round_robin',
    status: 'upcoming',
    current_round: 0,
    season_id: 's-1',
    season_format_type: 'custom',
    best_of_default: 1,
    bo_overrides: {},
  } as never);
  vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  vi.mocked(getMatchesByTournament).mockResolvedValue([]);
  vi.mocked(getPairedMatchRecords).mockResolvedValue([]);
  vi.mocked(getSeasonGroups).mockResolvedValue([]);
  vi.mocked(createRound).mockImplementation(async (input) => ({ id: `r-${input.round_number}`, ...input }) as never);
});

describe('generate-all-rounds on a kit phase', () => {
  it('refuses a manual stage', async () => {
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'manual' }));
    const res = await POST({} as NextRequest, routeParams);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('rounds_manual_pairing');
    expect(createRound).not.toHaveBeenCalled();
  });

  it('plays each own group over the legs, the second leg with sides swapped', async () => {
    vi.mocked(getParticipants).mockResolvedValue(['p1', 'p2', 'p3', 'p4'].map((id) => ({ id })) as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'round_robin', legs: 2, mirror_legs: true }));
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('g1', 1, ['p1', 'p4']), group('g2', 2, ['p2', 'p3'])] as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    expect(vi.mocked(createRound).mock.calls.map((call) => call[0].round_number)).toEqual([1, 2]);
    expect(written()).toEqual([
      ['p1-p4', 'p2-p3'],
      ['p4-p1', 'p3-p2'],
    ]);
  });

  it('lets a smaller group rest while a larger one plays on', async () => {
    vi.mocked(getParticipants).mockResolvedValue(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })) as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'round_robin', legs: 1, mirror_legs: true }));
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('g1', 1, ['a', 'b', 'c']), group('g2', 2, ['d', 'e'])] as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    const rounds = vi.mocked(createRound).mock.calls.map((call) => call[0]);
    expect(rounds.map((round) => round.round_number)).toEqual([1, 2, 3]);
    const all = written();
    expect(all[0]).toContain('d-e');
    expect(all.slice(1).flat().some((pair) => pair.includes('d') || pair.includes('e'))).toBe(false);
    // Three players play three rounds: one sits out each round.
    expect(rounds.every((round) => (round.bye_player_ids ?? []).length === 1)).toBe(true);
  });
});

describe('generate-all-rounds: a stage end condition bounds the batch', () => {
  const players = ['p1', 'p2', 'p3', 'p4'];
  const roundRobin: Pairing = { kind: 'round_robin', legs: 1, mirror_legs: true };

  beforeEach(() => {
    vi.mocked(getParticipants).mockResolvedValue(players.map((id) => ({ id })) as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
  });

  it('stops at a rounds bound: the stage is over once that many rounds are played', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(phase(roundRobin, { kind: 'rounds', rounds: 2 }));

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    // Four players play three rounds, the bound stops the batch at two.
    expect(vi.mocked(createRound).mock.calls.map((call) => call[0].round_number)).toEqual([1, 2]);
  });

  it('writes the whole schedule when the rounds bound is not below it', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(phase(roundRobin, { kind: 'rounds', rounds: 9 }));

    expect((await POST({} as NextRequest, routeParams)).status).toBe(201);

    expect(vi.mocked(createRound).mock.calls.map((call) => call[0].round_number)).toEqual([1, 2, 3]);
  });

  it('stops a rounds bound on league week-plan groups at the bound too', async () => {
    vi.mocked(getParticipants).mockResolvedValue(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id })) as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase(roundRobin, { kind: 'rounds', rounds: 2 }));
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      group('g1', 1, ['a', 'b', 'c'], 'sg-1'),
      group('g2', 2, ['d', 'e', 'f'], 'sg-2'),
    ] as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    const numbers = vi.mocked(createRound).mock.calls.map((call) => call[0].round_number);
    expect(numbers).toEqual([1, 2]);
  });

  it('refuses a batch of several rounds for an expression bound before any round is written', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(
      phase(roundRobin, { kind: 'expr', when: { k: 'bool', v: false } } as never),
    );

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('rounds_batch_end_when_expression');
    expect(createRound).not.toHaveBeenCalled();
    expect(createMatchBatch).not.toHaveBeenCalled();
  });

  it('lets an expression-bounded stage write its last remaining round', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(
      phase(roundRobin, { kind: 'expr', when: { k: 'bool', v: false } } as never),
    );
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { id: 'r-1', round_number: 1, name: 'Round 1', status: 'completed' },
      { id: 'r-2', round_number: 2, name: 'Round 2', status: 'completed' },
    ] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      { id: 'm-1', round_id: 'r-1', status: 'completed' },
      { id: 'm-2', round_id: 'r-2', status: 'completed' },
    ] as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    expect(vi.mocked(createRound).mock.calls.map((call) => call[0].round_number)).toEqual([3]);
  });

  it('refuses a batch of one for an expression bound while an earlier round has unfinished matches', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(
      phase(roundRobin, { kind: 'expr', when: { k: 'bool', v: false } } as never),
    );
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { id: 'r-1', round_number: 1, name: 'Round 1', status: 'completed' },
      { id: 'r-2', round_number: 2, name: 'Round 2', status: 'active' },
    ] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      { id: 'm-1', round_id: 'r-1', status: 'completed' },
      { id: 'm-2', round_id: 'r-2', status: 'completed' },
      { id: 'm-3', round_id: 'r-2', status: 'scheduled' },
    ] as never);

    const res = await POST({} as NextRequest, routeParams);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('rounds_end_when_round_open');
    expect(body.params).toEqual({ round: 'Round 2' });
    expect(createRound).not.toHaveBeenCalled();
    expect(createMatchBatch).not.toHaveBeenCalled();
  });

  it('reads the open-round guard before the stage-end check, so a match completed in between is seen by the check', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(
      phase(roundRobin, { kind: 'expr', when: { k: 'bool', v: false } } as never),
    );
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { id: 'r-1', round_number: 1, name: 'Round 1', status: 'completed' },
      { id: 'r-2', round_number: 2, name: 'Round 2', status: 'active' },
    ] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      { id: 'm-1', round_id: 'r-1', status: 'completed' },
      { id: 'm-2', round_id: 'r-2', status: 'completed' },
    ] as never);

    expect((await POST({} as NextRequest, routeParams)).status).toBe(201);

    // The stage-end check loads the format context; the guard's match read has to come first.
    const guardRead = vi.mocked(getMatchesByTournament).mock.invocationCallOrder[0];
    const endCheck = vi.mocked(loadFreshKitContext).mock.invocationCallOrder[0];
    expect(guardRead).toBeDefined();
    expect(endCheck).toBeDefined();
    expect(guardRead).toBeLessThan(endCheck);
  });

  it('refuses on the open round without running the stage-end check', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(
      phase(roundRobin, { kind: 'expr', when: { k: 'bool', v: false } } as never),
    );
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r-2', round_number: 2, name: 'Round 2', status: 'active' }] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([{ id: 'm-2', round_id: 'r-2', status: 'scheduled' }] as never);

    expect((await POST({} as NextRequest, routeParams)).status).toBe(409);
    expect(loadFreshKitContext).not.toHaveBeenCalled();
  });

  it('lets a batch of one pass a rounds bound while an earlier round is still open', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(phase(roundRobin, { kind: 'rounds', rounds: 3 }));
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { id: 'r-1', round_number: 1, name: 'Round 1', status: 'completed' },
      { id: 'r-2', round_number: 2, name: 'Round 2', status: 'active' },
    ] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      { id: 'm-1', round_id: 'r-1', status: 'completed' },
      { id: 'm-2', round_id: 'r-2', status: 'scheduled' },
    ] as never);

    expect((await POST({} as NextRequest, routeParams)).status).toBe(201);
  });
});

describe('generate-all-rounds: legs on groups that mirror league groups', () => {
  beforeEach(() => {
    vi.mocked(getParticipants).mockResolvedValue(['p1', 'p2', 'p3', 'p4'].map((id) => ({ id })) as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      group('g1', 1, ['p1', 'p4'], 'sg-1'),
      group('g2', 2, ['p2', 'p3'], 'sg-2'),
    ] as never);
  });

  it('refuses a round robin of two legs instead of playing a single leg', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'round_robin', legs: 2, mirror_legs: true }));

    const res = await POST({} as NextRequest, routeParams);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('rounds_mirrored_groups_legs');
    expect(body.params).toMatchObject({ legs: 2 });
    expect(createRound).not.toHaveBeenCalled();
  });

  it('refuses a filter over a two-leg round robin the same way', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(
      phase({ kind: 'filter', base: { kind: 'round_robin', legs: 2, mirror_legs: true }, allow: { k: 'bool', v: true } } as never),
    );

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('rounds_mirrored_groups_legs');
  });

  it('still plays a single leg on the league week plan', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'round_robin', legs: 1, mirror_legs: true }));

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    expect(createRound).toHaveBeenCalled();
  });

  it('does not touch a phase that is not on the kit engine', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(null as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
  });
});

describe('generate-all-rounds: the first rounds of a kit phase wait for the format set-up', () => {
  beforeEach(() => {
    vi.mocked(getParticipants).mockResolvedValue(['p1', 'p2', 'p3', 'p4'].map((id) => ({ id })) as never);
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'round_robin', legs: 1, mirror_legs: true }));
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('g1', 1, ['p1', 'p4']), group('g2', 2, ['p2', 'p3'])] as never);
  });

  it('refuses with 409 format_not_ready while the relation is undrawn, before any round is written', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext({ openChecks: 1 }));

    const res = await POST({} as NextRequest, routeParams);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('format_not_ready');
    expect(body.params).toMatchObject({ reasons: 'relation_undrawn,action_incomplete', open_checks: 1 });
    expect(createRound).not.toHaveBeenCalled();
  });

  it('writes the rounds once the relation is drawn', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext({ drawn: true }));

    expect((await POST({} as NextRequest, routeParams)).status).toBe(201);
    expect(createRound).toHaveBeenCalled();
  });

  it('lets an admin start anyway with ?force=true and audits it', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext());

    expect((await POST(forced, routeParams)).status).toBe(201);

    expect(createRound).toHaveBeenCalled();
    expect(vi.mocked(logAuditEvent).mock.calls.find((call) => call[0].action === 'season.format.round.force_start')?.[0]).toMatchObject({
      actor_id: 'admin-1',
      resource_id: ID,
      metadata: { reasons: ['relation_undrawn'], relations: ['santa'] },
    });
  });
});
