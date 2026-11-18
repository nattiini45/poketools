import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { NativePhaseInvalidation } from '@/lib/league-phase/services';
import { POST } from '../route';

const h = vi.hoisted(() => ({
  auth: vi.fn(), mode: vi.fn(), owner: vi.fn(), services: vi.fn(), decide: vi.fn(),
  expireSeason: vi.fn(), revalidateMatch: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: h.auth }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({ findNativePhaseAliasOwner: h.owner }));
vi.mock('@/lib/league-phase/services', () => ({ createNativePhaseServices: h.services }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: h.expireSeason, revalidatePhaseMatchPages: h.revalidateMatch }));

const id = '10000000-0000-4000-8000-000000000001';
const phaseId = '20000000-0000-4000-8000-000000000002';
const matchId = '30000000-0000-4000-8000-0000000000ab';
const player = { playerId: 'viewer' };
const call = (league = id, match = matchId.toUpperCase(), query = '') =>
  POST(new NextRequest('http://localhost/' + query, { method: 'POST', body: JSON.stringify({ action: 'confirm' }) }),
    { params: Promise.resolve({ id: league, phaseId, matchId: match }) });

beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue(player);
  h.mode.mockResolvedValue('phase');
  h.owner.mockResolvedValue({ kind: 'phase', season_id: id, phase_id: phaseId });
  h.services.mockReturnValue({ matches: { decide: h.decide } });
  h.decide.mockResolvedValue(NextResponse.json({ success: true }));
});

it('passes the verified match and live player to the native decision workflow', async () => {
  expect((await call()).status).toBe(200);
  expect(h.owner).toHaveBeenCalledExactlyOnceWith({ phaseId, matchId });
  const [request, context, actor, adminOnly] = h.decide.mock.calls[0];
  expect(await request.json()).toEqual({ action: 'confirm' });
  expect(await context.params).toEqual({ mid: matchId });
  expect(actor).toBe(player);
  expect(adminOnly).toBe(false);
  const invalidate: NativePhaseInvalidation = h.services.mock.calls[0][0];
  await invalidate.invalidateMatch(phaseId, matchId);
  invalidate.invalidateSeason(id, [phaseId]);
  expect(h.revalidateMatch).toHaveBeenCalledExactlyOnceWith(phaseId, matchId, id);
  expect(h.expireSeason).toHaveBeenCalledExactlyOnceWith(id, { phaseIds: [phaseId] });
});

it('passes strict admin intent to the same scoped decision workflow', async () => {
  expect((await call(id, matchId, '?as=admin')).status).toBe(200);
  expect(h.owner).toHaveBeenCalledExactlyOnceWith({ phaseId, matchId });
  expect(h.decide).toHaveBeenCalledExactlyOnceWith(expect.any(NextRequest), { params: expect.any(Promise) }, player, true);
});

it('rejects unknown intent values without resolving an owner', async () => {
  expect((await call(id, matchId, '?as=manager')).status).toBe(400);
  expect(h.owner).not.toHaveBeenCalled();
  expect(h.decide).not.toHaveBeenCalled();
});

it('rejects a wrong league and a missing or wrong-phase match without invoking the workflow', async () => {
  expect((await call('40000000-0000-4000-8000-000000000004')).status).toBe(404);
  h.owner.mockResolvedValue(null);
  expect((await call()).status).toBe(404);
  expect(h.services).not.toHaveBeenCalled();
});

it('does not resolve owners in legacy or frozen mode', async () => {
  h.mode.mockResolvedValueOnce('legacy');
  expect((await call()).status).toBe(404);
  h.mode.mockRejectedValueOnce(new UserFacingError('Unavailable', { code: 'phase_storage_unavailable', status: 503 }));
  expect((await call()).status).toBe(503);
  expect(h.owner).not.toHaveBeenCalled();
  expect(h.decide).not.toHaveBeenCalled();
});

it('checks live access before readiness or owner lookup', async () => {
  h.auth.mockRejectedValueOnce(new UserFacingError('Forbidden', { code: 'forbidden', status: 403 }));
  expect((await call()).status).toBe(403);
  expect(h.mode).not.toHaveBeenCalled();
  expect(h.owner).not.toHaveBeenCalled();
});
