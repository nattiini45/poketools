import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { POST } from '../route';

const h = vi.hoisted(() => ({
  auth: vi.fn(), mode: vi.fn(), owner: vi.fn(), mark: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: h.auth }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({ findNativePhaseAliasOwner: h.owner }));
vi.mock('@/lib/supabase/queries/phase-epb-animation-views', () => ({ markPhaseEpbReplayViewed: h.mark }));

const id = '10000000-0000-4000-8000-000000000001';
const phaseId = '20000000-0000-4000-8000-000000000002';
const matchId = '30000000-0000-4000-8000-0000000000ab';
const request = new NextRequest('http://localhost', { method: 'POST' });
const call = (league = id, match = matchId.toUpperCase()) =>
  POST(request, { params: Promise.resolve({ id: league, phaseId, matchId: match }) });

beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue({ playerId: 'viewer' });
  h.mode.mockResolvedValue('phase');
  h.owner.mockResolvedValue({ kind: 'phase', season_id: id, phase_id: phaseId });
});

it('marks only the authorized player and the match scoped to the native phase', async () => {
  expect(await (await call()).json()).toEqual({ success: true, data: { viewed: true } });
  expect(h.owner).toHaveBeenCalledExactlyOnceWith({ phaseId, matchId });
  expect(h.mark).toHaveBeenCalledExactlyOnceWith('viewer', matchId);
});

it('does not consult readiness when authentication fails', async () => {
  h.auth.mockRejectedValueOnce(new UserFacingError('Forbidden', { code: 'forbidden', status: 403 }));
  expect((await call()).status).toBe(403);
  expect(h.mode).not.toHaveBeenCalled();
  expect(h.mark).not.toHaveBeenCalled();
});

it.each([undefined, 'legacy', 'frozen'])('does not write for an unverified or unavailable native match (%s)', async mode => {
  if (mode === 'legacy') h.mode.mockResolvedValue(mode);
  if (mode === 'frozen') h.mode.mockRejectedValue(new UserFacingError('Unavailable', { code: 'phase_storage_unavailable', status: 503 }));
  h.owner.mockResolvedValue(null);
  expect((await call()).status).toBe(mode === 'frozen' ? 503 : 404);
  if (mode !== undefined) expect(h.owner).not.toHaveBeenCalled();
  expect(h.mark).not.toHaveBeenCalled();
});

it('rejects a valid match addressed under a different league', async () => {
  expect((await call('40000000-0000-4000-8000-000000000004')).status).toBe(404);
  expect(h.mark).not.toHaveBeenCalled();
});
