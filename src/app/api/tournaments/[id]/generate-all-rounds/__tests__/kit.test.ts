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

import { POST } from '@/app/api/tournaments/[id]/generate-all-rounds/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { createRound, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { createMatchBatch, getMatchesByTournament, getPairedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { loadKitPhase, type KitPhase } from '@/lib/format-engine/load';
import type { Pairing, Stage } from '@/lib/format-kit/types';

const ID = 'a5cb20ac-a127-482d-855d-d802e29185bc';
const routeParams = { params: Promise.resolve({ id: ID }) };

function phase(pairing: Pairing): KitPhase {
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
  };
  return { engine: 'kit', seed: 'seed-0123456789', stage, outcomes: {} };
}

const group = (id: string, n: number, players: string[]) => ({
  id,
  group_number: n,
  name: `Group ${n}`,
  season_group_id: null,
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
