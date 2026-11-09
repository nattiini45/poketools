/**
 * The status moves of a tournament or league phase through the two admin PATCH routes (tournamentMachine,
 * src/lib/tournament/tournament-state.ts): every move a legitimate flow performs is accepted and written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/format-studio/phase-guards', () => ({
  assertFormatPhaseDeletable: vi.fn(),
  assertFormatPhaseUnchanged: vi.fn(),
  assertFormatPhaseStatusUnchanged: vi.fn(),
}));
vi.mock('@/lib/ruleset-studio/pin-change', () => ({ assertRulesetChangeAllowed: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getTournamentWithDetails: vi.fn(),
  updateTournament: vi.fn(),
  deleteTournament: vi.fn(),
  getParticipants: vi.fn(),
  getStagesBySeasonId: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({ rebuildAfterTournamentDelete: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn(), diffField: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onPhaseStatusChanged: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-end-advance', () => ({
  advanceAfterStageEnd: vi.fn(),
  stageEndFired: vi.fn(),
}));

import { PATCH as patchTournament } from '@/app/api/tournaments/[id]/route';
import { PATCH as patchPhase } from '@/app/api/seasons/[id]/phases/[phaseId]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getTournamentById, getTournamentWithDetails, updateTournament } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { onPhaseStatusChanged } from '@/lib/format-engine/runtime/hooks';
import { advanceAfterStageEnd } from '@/lib/format-engine/runtime/stage-end-advance';
import type { TournamentStatus } from '@/types/tournament';

const ID = '22222222-2222-4222-8222-222222222222';
const SEASON = '33333333-3333-4333-8333-333333333333';

const row = (status: TournamentStatus, seasonId: string | null) => ({
  id: ID,
  name: 'Spring Cup',
  season_id: seasonId,
  season_format_type: seasonId === null ? null : 'custom',
  status,
  bracket_type: 'swiss' as const,
  ruleset_id: null,
  best_of_default: 1,
  bo_overrides: {},
  is_doubles: false,
  team_visibility: 'public',
  stage_order: 1,
  archived: false,
});

const tournamentRequest = (body: unknown) =>
  patchTournament({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest, { params: Promise.resolve({ id: ID }) });

const phaseRequest = (body: unknown) =>
  patchPhase(
    new NextRequest(`http://localhost:3000/api/seasons/${SEASON}/phases/${ID}`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: SEASON, phaseId: ID }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'p-1', name: 'Admin' } as never);
  vi.mocked(updateTournament).mockImplementation(async (_id, input) => ({ ...row('upcoming', null), ...input }) as never);
  vi.mocked(onPhaseStatusChanged).mockResolvedValue(true);
  vi.mocked(advanceAfterStageEnd).mockResolvedValue({ results: [], error: null, ran: false } as never);
  vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  vi.mocked(getTournamentWithDetails).mockResolvedValue({ ...row('active', SEASON), rounds: [], participants: [] } as never);
});

const LEGAL_ADMIN_MOVES: [TournamentStatus, TournamentStatus][] = [
  ['upcoming', 'active'],
  ['upcoming', 'completed'],
  ['active', 'completed'],
  ['completed', 'active'],
];

describe('PATCH /api/tournaments/[id]: legal status moves', () => {
  it.each(LEGAL_ADMIN_MOVES)('standalone %s -> %s is written', async (from, to) => {
    vi.mocked(getTournamentById).mockResolvedValue(row(from, null) as never);
    const res = await tournamentRequest({ status: to });
    expect(res.status).toBe(200);
    expect(updateTournament).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateTournament).mock.calls[0][1]).toEqual({ status: to });
  });

  it.each(LEGAL_ADMIN_MOVES)('league phase %s -> %s is written and the format reacts', async (from, to) => {
    vi.mocked(getTournamentById).mockResolvedValue(row(from, SEASON) as never);
    const res = await tournamentRequest({ status: to });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateTournament).mock.calls[0][1]).toEqual({ status: to });
    expect(onPhaseStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ from, to }));
  });

  it.each<TournamentStatus>(['active', 'completed'])('a repeat of %s replays the format reaction', async (status) => {
    vi.mocked(getTournamentById).mockResolvedValue(row(status, SEASON) as never);
    const res = await tournamentRequest({ status });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateTournament).mock.calls[0][1]).toEqual({ status });
    expect(onPhaseStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ from: status === 'completed' ? 'active' : 'upcoming', to: status }),
    );
  });

  it('a body without a status writes the other fields at any status', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(row('active', null) as never);
    const res = await tournamentRequest({ name: 'Autumn Cup' });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateTournament).mock.calls[0][1]).toEqual({ name: 'Autumn Cup' });
    expect(onPhaseStatusChanged).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/seasons/[id]/phases/[phaseId]: legal status moves', () => {
  it.each(LEGAL_ADMIN_MOVES)('%s -> %s is written', async (from, to) => {
    vi.mocked(getTournamentById).mockResolvedValue(row(from, SEASON) as never);
    const res = await phaseRequest({ status: to });
    expect(res.status).toBe(200);
    expect(updateTournament).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateTournament).mock.calls[0][1]).toEqual({ status: to });
  });
});

describe('refused status moves: nothing moves a phase or tournament back to upcoming', () => {
  const REFUSED: [TournamentStatus, TournamentStatus][] = [
    ['active', 'upcoming'],
    ['completed', 'upcoming'],
  ];

  it.each(REFUSED)('tournament route %s -> %s is 409 state_transition_invalid, nothing written', async (from, to) => {
    vi.mocked(getTournamentById).mockResolvedValue(row(from, SEASON) as never);
    const res = await tournamentRequest({ status: to });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('state_transition_invalid');
    expect(updateTournament).not.toHaveBeenCalled();
    expect(onPhaseStatusChanged).not.toHaveBeenCalled();
  });

  it.each(REFUSED)('phase route %s -> %s is 409 state_transition_invalid, nothing written', async (from, to) => {
    vi.mocked(getTournamentById).mockResolvedValue(row(from, SEASON) as never);
    const res = await phaseRequest({ status: to });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('state_transition_invalid');
    expect(updateTournament).not.toHaveBeenCalled();
  });
});

describe('the status write is a compare-and-set on the status read', () => {
  it('passes the read status as the guard when the body carries a status, and none otherwise', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(row('active', null) as never);
    await tournamentRequest({ status: 'completed' });
    expect(vi.mocked(updateTournament).mock.calls[0][2]).toEqual({ from: 'active' });

    vi.mocked(updateTournament).mockClear();
    await tournamentRequest({ name: 'Autumn Cup' });
    expect(vi.mocked(updateTournament).mock.calls[0][2]).toBeUndefined();
  });

  it('the phase route guards the same way', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(row('completed', SEASON) as never);
    await phaseRequest({ status: 'active' });
    expect(vi.mocked(updateTournament).mock.calls[0][2]).toEqual({ from: 'completed' });
  });

  it('answers the 409 of a row that moved on and runs no status effect', async () => {
    const { UserFacingError } = await import('@/lib/api/user-facing-error');
    vi.mocked(getTournamentById).mockResolvedValue(row('active', SEASON) as never);
    vi.mocked(updateTournament).mockRejectedValue(
      new UserFacingError('changed', { code: 'tournament_status_changed', status: 409 }),
    );
    const res = await tournamentRequest({ status: 'completed' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('tournament_status_changed');
    expect(onPhaseStatusChanged).not.toHaveBeenCalled();
    expect(advanceAfterStageEnd).not.toHaveBeenCalled();
  });
});

