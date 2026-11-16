import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ requirePlayer: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: mocks.requirePlayer }));
vi.mock('@/lib/team-comparison.server', () => ({ loadTeamComparison: mocks.load }));
import { GET } from '../route';

const playerId = '11111111-1111-4111-8111-111111111111';
const leagueId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePlayer.mockResolvedValue({ playerId: 'viewer' });
  mocks.load.mockResolvedValue({ leagues: [], leagueId: null, mine: { hidden: false, pokemon: [] }, theirs: { hidden: false, pokemon: [] }, myHits: [], theirHits: [] });
});

it('uses the live registered viewer and never caches their private response', async () => {
  const response = await GET(new NextRequest(`http://localhost/api/players/${playerId}/team-comparison?season_id=${leagueId}`), { params: Promise.resolve({ id: playerId }) });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(mocks.load).toHaveBeenCalledWith('viewer', playerId, leagueId);
});

it('refuses a malformed player id before any comparison reads', async () => {
  const response = await GET(new NextRequest('http://localhost/api/players/bad/team-comparison'), { params: Promise.resolve({ id: 'bad' }) });
  expect(response.status).toBe(404);
  expect(mocks.load).not.toHaveBeenCalled();
});

it('refuses a malformed league id before any comparison reads', async () => {
  const response = await GET(new NextRequest(`http://localhost/api/players/${playerId}/team-comparison?season_id=bad`), { params: Promise.resolve({ id: playerId }) });
  expect(response.status).toBe(404);
  expect(mocks.load).not.toHaveBeenCalled();
});

it('fails closed when the live player guard refuses access', async () => {
  mocks.requirePlayer.mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401, code: 'unauthorized' }));
  const response = await GET(new NextRequest('http://localhost/api/players/example/team-comparison'), { params: Promise.resolve({ id: playerId }) });
  expect(response.status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
});

it('does not expose a database error', async () => {
  mocks.load.mockRejectedValue(new Error('private database details'));
  const response = await GET(new NextRequest('http://localhost/api/players/example/team-comparison'), { params: Promise.resolve({ id: playerId }) });
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private database details');
});
