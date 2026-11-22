import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { MOMENTS_NOT_SAVED_WARNING } from '@/lib/broadcast/moment-limits';
import { POST } from '../route';

const h = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), limit: vi.fn(), mode: vi.fn(), owner: vi.fn(), match: vi.fn(),
  services: vi.fn(), record: vi.fn(), moments: vi.fn(), effects: vi.fn(), logError: vi.fn(), invalidate: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: h.auth }));
vi.mock('@/lib/auth/phase-access', () => ({ assertMayRecordPhaseResult: h.access }));
vi.mock('@/lib/utils/rate-limit', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/utils/rate-limit')>(), checkRateLimit: h.limit,
}));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({ findNativePhaseAliasOwner: h.owner }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: h.match }));
vi.mock('@/lib/league-phase/services', () => ({ createNativePhaseServices: h.services }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn(), revalidatePhaseMatchPages: h.invalidate }));
vi.mock('@/lib/supabase/queries/phase-broadcast-moments', () => ({ createPhaseMomentsBatch: h.moments }));
vi.mock('@/lib/league-phase/result-effects', () => ({ emitPhaseResultEffects: h.effects }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: h.logError, warn: vi.fn() } }));

const id = '10000000-0000-4000-8000-0000000000aa';
const phaseId = '20000000-0000-4000-8000-0000000000bb';
const matchId = '30000000-0000-4000-8000-0000000000cc';
const p1 = '40000000-0000-4000-8000-000000000001';
const p2 = '40000000-0000-4000-8000-000000000002';
const outsider = '40000000-0000-4000-8000-000000000003';
const gameId = '50000000-0000-4000-8000-000000000001';
const owner = { kind: 'phase', phase_id: phaseId, season_id: id };
const match = { id: matchId, phase_id: phaseId, player_1_id: p1, player_2_id: p2 };
const player = { playerId: p1, isAdmin: false };
const body = { match_id: matchId, winner_id: p2, pokemon_stats: [{ player_id: p2, pokemon: [{ pokemon_name: 'Pikachu' }] }] };
const result = {
  game_id: gameId, game_winner_id: p2, match_status: 'in_progress', match_winner_id: null,
  bo_reached: false, evolution_events: [],
};
const path = { id: id.toUpperCase(), phaseId: phaseId.toUpperCase(), matchId: matchId.toUpperCase() };
const call = (input: unknown = body, params = path) =>
  POST(new NextRequest('http://localhost', { method: 'POST', body: typeof input === 'string' ? input : JSON.stringify(input) }),
    { params: Promise.resolve(params) });

beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue(player);
  h.access.mockResolvedValue({ asAdmin: false });
  h.limit.mockResolvedValue({ allowed: true });
  h.mode.mockResolvedValue('phase');
  h.owner.mockResolvedValue(owner);
  h.match.mockResolvedValue(match);
  h.services.mockReturnValue({ matches: { recordGameResult: h.record } });
  h.record.mockResolvedValue(result);
});

it('records through native services with scoped IDs, shared stat defaults and live access', async () => {
  h.record.mockImplementationOnce(async () => {
    await h.services.mock.calls[0][0].invalidateMatch(phaseId, matchId);
    return result;
  });
  const response = await call({ ...body, screenshot_url: 'https://example.com/proof.png' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, data: { ...result, moments_saved: 0 } });
  expect(h.limit).toHaveBeenCalledExactlyOnceWith('manual-result', p1, { limit: 20, windowSeconds: 3600 });
  expect(h.owner).toHaveBeenCalledExactlyOnceWith({ phaseId, matchId });
  expect(h.access).toHaveBeenCalledExactlyOnceWith(player, match);
  expect(h.access).toHaveBeenCalledBefore(h.record);
  expect(h.record).toHaveBeenCalledExactlyOnceWith({
    match_id: matchId, winner_id: p2, screenshot_url: 'https://example.com/proof.png',
    source: 'manual', submitter_id: p1, is_admin: false,
    battle_stats: [{ game_id: '', player_id: p2, pokemon_name: 'Pikachu', was_brought: true,
      was_lead: false, kos_dealt: 0, was_koed: false, moves_used: [], turns_active: 0 }],
  });
  expect(h.moments).not.toHaveBeenCalled();
  expect(h.invalidate).toHaveBeenCalledExactlyOnceWith(phaseId, matchId, id);
  expect(h.effects).toHaveBeenCalledExactlyOnceWith(owner, matchId, result);
  expect(h.record).toHaveBeenCalledBefore(h.effects);
});

it('binds tracker moments to the recorded game and authenticated admin, ignoring request IDs', async () => {
  h.auth.mockResolvedValue({ playerId: outsider, isAdmin: false });
  h.access.mockResolvedValue({ asAdmin: true });
  const timestamp = '2026-01-01T00:00:00.000Z';
  const response = await call({ ...body, moments: [
    { moment_type: 'highlight', match_id: 'spoofed', game_id: 'spoofed', created_by: 'spoofed' },
    { moment_type: 'big_ko', timestamp, turn_number: 7 },
  ] });
  expect(await response.json()).toMatchObject({ success: true, data: { moments_saved: 2 } });
  expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ submitter_id: outsider, is_admin: true }));
  expect(h.moments).toHaveBeenCalledExactlyOnceWith([
    { match_id: matchId, game_id: gameId, created_by: outsider, moment_type: 'highlight', timestamp: expect.any(String),
      turn_number: null, description: null, pokemon_name: null },
    { match_id: matchId, game_id: gameId, created_by: outsider, moment_type: 'big_ko', timestamp,
      turn_number: 7, description: null, pokemon_name: null },
  ]);
  expect(h.record).toHaveBeenCalledBefore(h.moments);
});

it('returns a tracker warning and still runs result effects when a moment insert fails', async () => {
  const error = new Error('moment write failed');
  h.moments.mockRejectedValue(error);
  const response = await call({ ...body, moments: [{ moment_type: 'highlight' }] });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, data: {
    ...result, moments_saved: 0, warning: { code: MOMENTS_NOT_SAVED_WARNING, params: { count: 1 } },
  } });
  expect(h.logError).toHaveBeenCalledWith('phase/manual-result', expect.any(String), expect.objectContaining({ gameId, error }));
  expect(h.effects).toHaveBeenCalledOnce();
});

it('runs the live player guard first and short-circuits a denied rate limit', async () => {
  h.auth.mockRejectedValueOnce(new UserFacingError('Forbidden', { code: 'forbidden', status: 403 }));
  expect((await call()).status).toBe(403);
  expect(h.limit).not.toHaveBeenCalled();
  h.limit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 90 });
  const denied = await call();
  expect(denied.status).toBe(429);
  expect(denied.headers.get('Retry-After')).toBe('90');
  expect(h.mode).not.toHaveBeenCalled();
});

it.each([
  ['{', 'invalid_json'],
  [{ ...body, match_id: p2 }, 'validation_failed'],
  [{ ...body, moments: [{ moment_type: 'unknown' }] }, 'validation_failed'],
])('rejects invalid, mismatched or malformed bodies before ownership queries: %j', async (input, code) => {
  const response = await call(input);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ success: false, code });
  expect(h.mode).not.toHaveBeenCalled();
  expect(h.record).not.toHaveBeenCalled();
});

it('rejects invalid path IDs, other leagues, missing ownership and wrong-phase matches', async () => {
  expect((await call(body, { ...path, matchId: 'invalid' })).status).toBe(404);
  expect(h.mode).not.toHaveBeenCalled();
  expect((await call(body, { ...path, id: outsider })).status).toBe(404);
  expect(h.match).not.toHaveBeenCalled();
  h.owner.mockResolvedValueOnce(null);
  expect((await call()).status).toBe(404);
  h.match.mockResolvedValueOnce({ ...match, phase_id: outsider });
  expect((await call()).status).toBe(404);
  h.match.mockResolvedValueOnce(null);
  expect((await call()).status).toBe(404);
  expect(h.access).not.toHaveBeenCalled();
  expect(h.record).not.toHaveBeenCalled();
});

it('does not read native match ownership in legacy or frozen generation', async () => {
  h.mode.mockResolvedValueOnce('legacy');
  expect((await call()).status).toBe(404);
  h.mode.mockRejectedValueOnce(new UserFacingError('Maintenance', { code: 'phase_storage_unavailable', status: 503 }));
  expect((await call()).status).toBe(503);
  expect(h.owner).not.toHaveBeenCalled();
  expect(h.record).not.toHaveBeenCalled();
});

it('rejects unauthorized actors, nonparticipant winners and nonparticipant stats without writes', async () => {
  h.access.mockRejectedValueOnce(new UserFacingError('Forbidden', { code: 'forbidden', status: 403 }));
  expect((await call()).status).toBe(403);
  const winner = await call({ ...body, winner_id: outsider });
  expect(winner.status).toBe(400);
  expect(await winner.json()).toMatchObject({ code: 'manual_result_winner_not_participant' });
  const stats = await call({ ...body, pokemon_stats: [{ ...body.pokemon_stats[0], player_id: outsider }] });
  expect(stats.status).toBe(400);
  expect(await stats.json()).toMatchObject({ code: 'match_player_not_participant' });
  expect(h.record).not.toHaveBeenCalled();
});

it('uses safe errors and skips all effects when recording fails', async () => {
  h.record.mockRejectedValue(new Error('pipeline internals'));
  const response = await call({ ...body, moments: [{ moment_type: 'highlight' }] });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ success: false, error: 'Failed to submit manual result' });
  expect(h.moments).not.toHaveBeenCalled();
  expect(h.effects).not.toHaveBeenCalled();
});
