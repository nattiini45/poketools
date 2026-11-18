import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { POST } from '../route';

const m = vi.hoisted(() => ({
  actor: vi.fn(), mode: vi.fn(), season: vi.fn(), phase: vi.fn(), round: vi.fn(), allowed: vi.fn(),
  roundMatches: vi.fn(), phaseMatches: vi.fn(), participants: vi.fn(), rounds: vi.fn(),
  reset: vi.fn(), finish: vi.fn(), expire: vi.fn(), revalidate: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: m.actor,
  AuthError: class extends Error {
    constructor(message: string, readonly statusCode: number, readonly code: string) { super(message); }
  },
}));
vi.mock('@/lib/auth/phase-access', () => ({ canAdministerPhaseAccess: m.allowed }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: m.mode }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: m.season }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: m.phase, getPhaseParticipants: m.participants }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({
  getPhaseRoundById: m.round, getRoundsByPhase: m.rounds, finishPhaseRoundReset: m.finish,
}));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchesByRound: m.roundMatches, getMatchesByPhase: m.phaseMatches }));
vi.mock('../../../_lib/effects', () => ({ nativeRoundServices: () => ({ matches: { resetMatch: m.reset } }) }));
vi.mock('@/lib/revalidation', () => ({ expirePhaseReads: m.expire, revalidatePhaseMatchPages: m.revalidate }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: m.audit }));

const id = '10000000-0000-4000-8000-0000000000a1';
const phaseId = '20000000-0000-4000-8000-0000000000b2';
const rid = '30000000-0000-4000-8000-0000000000c3';
const phase = { id: phaseId, season_id: id, bracket_type: 'round_robin', status: 'active', archived: false };
const round = { id: rid, phase_id: phaseId, round_number: 1, name: 'Round 1', status: 'completed', updated_at: '2026-11-18T10:00:00Z' };
const run = (cascade?: boolean) => POST(new NextRequest('http://localhost', {
  method: 'POST', ...(cascade === undefined ? {} : { body: JSON.stringify({ cascade }) }),
}), { params: Promise.resolve({ id, phaseId, rid }) });
const result = { games_deleted: 1, evolution_events: [] };

beforeEach(() => {
  vi.resetAllMocks();
  m.actor.mockResolvedValue({ playerId: 'test-admin', name: 'Test Admin' });
  m.mode.mockResolvedValue('phase');
  m.season.mockResolvedValue({ id });
  m.phase.mockResolvedValue(phase);
  m.round.mockResolvedValue(round);
  m.allowed.mockResolvedValue(true);
  m.roundMatches.mockResolvedValue([]);
  m.reset.mockResolvedValue(result);
  m.finish.mockResolvedValue({ ...round, status: 'pending' });
});

it('checks generation and the complete owner chain before reading or resetting results', async () => {
  m.mode.mockResolvedValueOnce('legacy');
  expect((await run()).status).toBe(404);
  expect(m.season).not.toHaveBeenCalled();
  m.round.mockResolvedValueOnce({ ...round, phase_id: 'another-phase' });
  expect((await run()).status).toBe(404);
  expect(m.roundMatches).not.toHaveBeenCalled();
  expect(m.reset).not.toHaveBeenCalled();
});

it('rolls back only played native matches in order, then verifies and refreshes the owned round', async () => {
  m.roundMatches.mockResolvedValue([
    { id: 'first', status: 'completed', games: [{ id: 'game' }] },
    { id: 'second', status: 'disputed', games: [] },
    { id: 'untouched', status: 'scheduled', games: [] },
  ]);
  const current = { ...round, status: 'active', updated_at: '2026-11-18T11:00:00Z' };
  m.round.mockResolvedValueOnce(round).mockResolvedValueOnce(current);
  m.reset.mockResolvedValueOnce({ ...result, format_revert_failed: true }).mockResolvedValueOnce({ ...result, games_deleted: 0 });
  const response = await run();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: { matches_reset: 2, total_games_deleted: 1, format_revert_failed: true },
  });
  expect(m.reset.mock.calls).toEqual([['first', 'test-admin', false], ['second', 'test-admin', false]]);
  expect(m.finish).toHaveBeenCalledExactlyOnceWith(id, phaseId, current, []);
  expect(m.finish.mock.invocationCallOrder[0]).toBeGreaterThan(m.reset.mock.invocationCallOrder[1]);
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
  expect(m.revalidate.mock.calls).toEqual([[phaseId, 'first', id], [phaseId, 'second', id]]);
});

it('refuses downstream results for the entire round until cascade is explicit', async () => {
  m.phase.mockResolvedValue({ ...phase, bracket_type: 'single_elim' });
  m.roundMatches.mockResolvedValue([
    { id: 'semi-a', round_id: rid, status: 'completed', bracket_side: 'winners', bracket_pos: 0, games: [] },
    { id: 'semi-b', round_id: rid, status: 'completed', bracket_side: 'winners', bracket_pos: 1, games: [] },
  ]);
  m.participants.mockResolvedValue(['a', 'b', 'c', 'd'].map((player, index) => ({ id: player, name: player, seed: index + 1 })));
  m.rounds.mockResolvedValue([round, { id: 'final', round_number: 2 }]);
  m.phaseMatches.mockResolvedValue([{ id: 'played-final', round_id: 'final', status: 'in_progress', bracket_side: 'winners', bracket_pos: 0, games: [] }]);
  const refusal = await run(false);
  expect(refusal.status).toBe(409);
  expect(await refusal.json()).toMatchObject({ code: 'DOWNSTREAM_PLAYED', params: { count: 1 } });
  expect(m.reset).not.toHaveBeenCalled();
  expect(m.finish).not.toHaveBeenCalled();
  expect((await run(true)).status).toBe(200);
  expect(m.reset.mock.calls).toEqual([['semi-a', 'test-admin', true], ['semi-b', 'test-admin', true]]);
  expect(m.finish).toHaveBeenCalledExactlyOnceWith(id, phaseId, round, ['played-final']);
  expect(m.revalidate).toHaveBeenCalledWith(phaseId, 'played-final', id);
});

it('refuses scheduled games before resetting otherwise eligible siblings', async () => {
  m.roundMatches.mockResolvedValue([
    { id: 'first', status: 'completed', games: [] },
    { id: 'second', status: 'scheduled', games: [{ id: 'game' }] },
  ]);
  const response = await run(true);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'phase_round_reset_scheduled_games' });
  expect(m.reset).not.toHaveBeenCalled();
  expect(m.finish).not.toHaveBeenCalled();
});

it('expires and audits partial work without pretending the round was moved', async () => {
  m.roundMatches.mockResolvedValue([
    { id: 'first', status: 'completed', games: [] }, { id: 'second', status: 'completed', games: [] },
  ]);
  m.reset.mockResolvedValueOnce(result).mockRejectedValueOnce(new UserFacingError('Round changed', { code: 'round_status_changed', status: 409 }));
  expect((await run()).status).toBe(409);
  expect(m.finish).not.toHaveBeenCalled();
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ completed: false, matches_reset: 1 }) }));
});
