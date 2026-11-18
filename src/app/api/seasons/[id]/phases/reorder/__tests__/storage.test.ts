import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../route';
import { UserFacingError } from '@/lib/api/user-facing-error';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  mode: vi.fn(),
  legacy: { listBySeason: vi.fn(), reorder: vi.fn() },
  native: { listBySeason: vi.fn(), reorder: vi.fn() },
  expire: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: mocks.admin }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: mocks.mode }));
vi.mock('@/lib/league-phase/lifecycle-persistence', () => ({
  legacyPhasePersistence: mocks.legacy,
  nativePhasePersistence: mocks.native,
}));
vi.mock('@/lib/format-studio/phase-guards', () => ({ assertSeasonPhasesFree: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: mocks.expire }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

const seasonId = '10000000-0000-4000-8000-0000000000ab';
const pinned = '20000000-0000-4000-8000-000000000001';
const first = '20000000-0000-4000-8000-0000000000ff';
const second = '20000000-0000-4000-8000-0000000000ee';
const stages = [
  { id: pinned, status: 'completed', stage_order: 1 },
  { id: first, status: 'upcoming', stage_order: 2 },
  { id: second, status: 'upcoming', stage_order: 3 },
];

function reorder(phaseIds = [second, first]) {
  return POST(new NextRequest(`http://localhost/api/seasons/${seasonId}/phases/reorder`, {
    method: 'POST',
    body: JSON.stringify({ phase_ids: phaseIds }),
  }), { params: Promise.resolve({ id: seasonId }) });
}

beforeEach(() => {
  mocks.admin.mockResolvedValue({ playerId: 'example-admin', name: 'Sample Admin' });
  mocks.mode.mockResolvedValue('phase');
  mocks.native.listBySeason.mockResolvedValue(stages);
  mocks.legacy.listBySeason.mockResolvedValue(stages);
});

afterEach(() => vi.resetAllMocks());

it('reorders only native phase rows and expires only phase and league reads in phase mode', async () => {
  const ordered = [pinned, second, first];
  const response = await reorder([second.toUpperCase(), first]);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ phase_ids: ordered });
  expect(mocks.native.listBySeason).toHaveBeenCalledExactlyOnceWith(seasonId);
  expect(mocks.native.reorder).toHaveBeenCalledExactlyOnceWith(seasonId, ordered);
  expect(mocks.expire).toHaveBeenCalledExactlyOnceWith(seasonId, { phaseIds: ordered });
  expect(mocks.legacy.listBySeason).not.toHaveBeenCalled();
  expect(mocks.legacy.reorder).not.toHaveBeenCalled();
});

it('keeps the legacy writes and expiry when the legacy generation is open', async () => {
  mocks.mode.mockResolvedValue('legacy');
  expect((await reorder()).status).toBe(200);
  expect(mocks.legacy.reorder).toHaveBeenCalledExactlyOnceWith(seasonId, [pinned, second, first]);
  expect(mocks.expire).toHaveBeenCalledExactlyOnceWith(seasonId, [pinned, second, first]);
  expect(mocks.native.listBySeason).not.toHaveBeenCalled();
  expect(mocks.native.reorder).not.toHaveBeenCalled();
});

it('rejects duplicates even when the request length matches the upcoming phase count', async () => {
  const response = await reorder([first, first.toUpperCase()]);
  expect(response.status).toBe(400);
  expect((await response.json()).code).toBe('PHASE_REORDER_INCOMPLETE');
  expect(mocks.native.reorder).not.toHaveBeenCalled();
  expect(mocks.expire).not.toHaveBeenCalled();
});

it('reads neither generation when cutover has frozen the phase routes', async () => {
  mocks.mode.mockRejectedValue(new UserFacingError('Unavailable', { code: 'phase_storage_unavailable', status: 503 }));
  expect((await reorder()).status).toBe(503);
  expect(mocks.native.listBySeason).not.toHaveBeenCalled();
  expect(mocks.legacy.listBySeason).not.toHaveBeenCalled();
  expect(mocks.expire).not.toHaveBeenCalled();
});

it('checks live league authorization before reading the state or either store', async () => {
  mocks.admin.mockRejectedValue(new UserFacingError('Forbidden', { code: 'forbidden', status: 403 }));
  expect((await reorder()).status).toBe(403);
  expect(mocks.mode).not.toHaveBeenCalled();
  expect(mocks.native.listBySeason).not.toHaveBeenCalled();
  expect(mocks.legacy.listBySeason).not.toHaveBeenCalled();
});
