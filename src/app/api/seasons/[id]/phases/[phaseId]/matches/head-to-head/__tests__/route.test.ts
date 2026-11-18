import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from '../route';
import { UserFacingError } from '@/lib/api/user-facing-error';

const h = vi.hoisted(() => ({
  mode: vi.fn(), owner: vi.fn(), native: vi.fn(), legacy: vi.fn(),
}));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({ resolveLeaguePhaseRoute: h.owner }));
vi.mock('@/lib/cache/public-reads', () => ({ publicReads: { tournamentHeadToHead: h.legacy } }));
vi.mock('@/lib/cache/phase-public-reads', () => ({ phasePublicReads: { headToHead: h.native } }));

const id = '10000000-0000-4000-8000-000000000001';
const phaseId = '20000000-0000-4000-8000-0000000000aa';
const a = '30000000-0000-4000-8000-0000000000ab';
const b = '40000000-0000-4000-8000-0000000000bc';
const summary = { id: 'match', phase_id: phaseId, winner_id: a, games: [{ winner_id: b }] };

function call(first = a, second = b, leagueId = id, phase = phaseId.toUpperCase()) {
  const req = new NextRequest(`http://localhost/api/seasons/${leagueId}/phases/${phase}/matches/head-to-head?player_1_id=${first}&player_2_id=${second}`);
  return GET(req, { params: Promise.resolve({ id: leagueId, phaseId: phase }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  h.mode.mockResolvedValue('phase');
  h.owner.mockResolvedValue({ kind: 'phase', phase_id: phaseId, season_id: id });
  h.native.mockResolvedValue([summary]);
});

it('reads the native pair only after resolving the exact league and phase', async () => {
  const response = await call(a.toUpperCase(), b);
  expect(await response.json()).toEqual({ success: true, data: [summary] });
  expect(h.owner).toHaveBeenCalledExactlyOnceWith(id, phaseId, 'phase');
  expect(h.native).toHaveBeenCalledExactlyOnceWith(phaseId, a, b);
  expect(h.legacy).not.toHaveBeenCalled();
});

it('maps the verified legacy phase to the same minimal summary', async () => {
  h.mode.mockResolvedValue('legacy');
  h.owner.mockResolvedValue({ kind: 'tournament', tournament_id: phaseId, season_id: id });
  h.legacy.mockResolvedValue([{ id: 'match', winner_id: a, notes: 'private', games: [{ winner_id: b, replay_url: 'unused' }] }]);
  expect(await (await call()).json()).toEqual({ success: true, data: [summary] });
  expect(h.owner).toHaveBeenCalledExactlyOnceWith(id, phaseId, 'legacy');
  expect(h.legacy).toHaveBeenCalledExactlyOnceWith(phaseId, a, b);
  expect(h.native).not.toHaveBeenCalled();
});

it('refuses a missing phase or wrong league without reading pair results', async () => {
  h.owner.mockResolvedValue(null);
  const response = await call();
  expect(response.status).toBe(404);
  expect((await response.json()).code).toBe('PHASE_NOT_FOUND');
  expect(h.native).not.toHaveBeenCalled();
  expect(h.legacy).not.toHaveBeenCalled();
});

it('does not resolve ownership in maintenance', async () => {
  h.mode.mockRejectedValue(new UserFacingError('Unavailable', { code: 'phase_storage_unavailable', status: 503 }));
  expect((await call()).status).toBe(503);
  expect(h.owner).not.toHaveBeenCalled();
});

it.each([
  ['', b, id, 400, 'MISSING_PARAM'],
  ['invalid', b, id, 400, 'INVALID_PARAM'],
  [a, a.toUpperCase(), id, 400, 'SAME_PLAYER'],
  [a, b, 'invalid', 404, 'INVALID_SEASON_ID'],
])('rejects invalid arguments before reading readiness (%s, %s, %s)', async (first, second, leagueId, status, code) => {
  const response = await call(first, second, leagueId);
  expect(response.status).toBe(status);
  expect((await response.json()).code).toBe(code);
  expect(h.mode).not.toHaveBeenCalled();
  expect(h.owner).not.toHaveBeenCalled();
});
