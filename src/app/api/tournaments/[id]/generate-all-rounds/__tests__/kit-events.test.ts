/**
 * generate-all-rounds on a kit phase reacts to the rounds it writes like generate-round does: the stage calendar's
 * deadline, `stage_start` / `round_start` through `onRoundGenerated`, the filter's check, and the stage-ended guard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: vi.fn(), AuthError: class AuthError extends Error {} }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
  updateTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
  createRoundWithMatches: vi.fn(),
  addMatchesToRound: vi.fn(),
  updateRoundStatus: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
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
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onRoundGenerated: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/calendar-server', () => ({ fillRoundDeadline: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-end-server', () => ({ assertStageNotEnded: vi.fn() }));
vi.mock('@/lib/format-engine/pairing-server', () => ({ loadPairingAids: vi.fn(), openForbiddenPairingCheck: vi.fn() }));

import { POST } from '@/app/api/tournaments/[id]/generate-all-rounds/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getParticipants, getTournamentById, updateTournament } from '@/lib/supabase/queries/tournaments';
import { createRoundWithMatches, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getMatchesByTournament, getPairedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import { loadKitPhase, type KitPhase } from '@/lib/format-engine/load';
import { onRoundGenerated } from '@/lib/format-engine/runtime/hooks';
import { fillRoundDeadline } from '@/lib/format-engine/runtime/calendar-server';
import { assertStageNotEnded } from '@/lib/format-engine/runtime/stage-end-server';
import { loadPairingAids } from '@/lib/format-engine/pairing-server';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Pairing, Stage } from '@/lib/format-kit/types';

const ID = 'a5cb20ac-a127-482d-855d-d802e29185bc';
const routeParams = { params: Promise.resolve({ id: ID }) };

function phase(pairing: Pairing, engine: KitPhase['engine'] = 'kit'): KitPhase {
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
  return { engine, seed: 'seed-0123456789', stage, outcomes: {}, tableExtras: {} };
}

const tournament = (status: string, current_round = 0) =>
  ({
    id: ID,
    name: 'League',
    bracket_type: 'round_robin',
    status,
    current_round,
    season_id: 's-1',
    season_format_type: 'custom',
    best_of_default: 1,
    bo_overrides: {},
  }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
  vi.mocked(getTournamentById).mockResolvedValue(tournament('upcoming'));
  vi.mocked(getParticipants).mockResolvedValue(['p1', 'p2', 'p3', 'p4'].map((id) => ({ id })) as never);
  vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  vi.mocked(getMatchesByTournament).mockResolvedValue([]);
  vi.mocked(getPairedMatchRecords).mockResolvedValue([]);
  vi.mocked(getSeasonGroups).mockResolvedValue([]);
  vi.mocked(getGroupsByTournament).mockResolvedValue([]);
  vi.mocked(updateTournament).mockResolvedValue(undefined as never);
  vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'round_robin', legs: 1, mirror_legs: false }));
  vi.mocked(loadPairingAids).mockResolvedValue({});
  vi.mocked(createRoundWithMatches).mockImplementation(async (input) => ({ id: `r-${input.round_number}`, deadline: null, ...input }) as never);
  vi.mocked(fillRoundDeadline).mockImplementation(async ({ round }) => ({ ...round, deadline: `2026-12-0${round.round_number}T00:00:00Z` }) as never);
});

describe('generate-all-rounds on a kit phase: the reactions of a written round', () => {
  it('announces every written round, lowest first, and starts the phase with the first', async () => {
    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    const calls = vi.mocked(onRoundGenerated).mock.calls.map(([input]) => input);
    expect(calls.map((call) => call.roundNumber)).toEqual([1, 2, 3]);
    expect(calls.map((call) => call.startsPhase)).toEqual([true, false, false]);
    expect(calls.every((call) => call.rematches === 0)).toBe(true);
  });

  it('does not start a phase that already started', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament('active'));

    await POST({} as NextRequest, routeParams);

    expect(vi.mocked(onRoundGenerated).mock.calls.map(([input]) => input.startsPhase)).toEqual([false, false, false]);
  });

  it('gives each round the stage calendar deadline and returns the filled rounds', async () => {
    const res = await POST({} as NextRequest, routeParams);

    expect(fillRoundDeadline).toHaveBeenCalledTimes(3);
    const body = await res.json();
    expect(body.data.map((round: { deadline: string }) => round.deadline)).toEqual([
      '2026-12-01T00:00:00Z',
      '2026-12-02T00:00:00Z',
      '2026-12-03T00:00:00Z',
    ]);
  });

  it('refuses a stage that reached its end before any round is written', async () => {
    vi.mocked(assertStageNotEnded).mockRejectedValue(
      new UserFacingError('This phase has reached its end condition.', { code: 'rounds_stage_ended', status: 409 }),
    );
    vi.mocked(getTournamentById).mockResolvedValue(tournament('active', 3));

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('rounds_stage_ended');
    expect(assertStageNotEnded).toHaveBeenCalledWith(expect.objectContaining({ seasonId: 's-1', phaseId: ID, currentRound: 3 }));
    expect(createRoundWithMatches).not.toHaveBeenCalled();
    expect(onRoundGenerated).not.toHaveBeenCalled();
  });

  it('leaves the reactions out for a phase that is not on the kit engine', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(phase({ kind: 'round_robin', legs: 1, mirror_legs: false }, 'shadow'));

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    expect(onRoundGenerated).not.toHaveBeenCalled();
    expect(fillRoundDeadline).not.toHaveBeenCalled();
    expect(assertStageNotEnded).not.toHaveBeenCalled();
  });

  it('leaves the reactions out for a league that is not a custom league', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...(tournament('upcoming') as object), season_format_type: 'swiss' } as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(201);
    expect(loadKitPhase).not.toHaveBeenCalled();
    expect(onRoundGenerated).not.toHaveBeenCalled();
  });
});
