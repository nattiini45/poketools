import { beforeEach, expect, it, vi } from 'vitest';
import { resolveIdOnlyMatchRoute } from '../match-route-owner';

const h = vi.hoisted(() => ({ mode: vi.fn(), native: vi.fn(), legacyPhase: vi.fn(), standalone: vi.fn() }));
vi.mock('../route-mode', () => ({ getPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: h.native, findLegacyPhaseAliasOwner: h.legacyPhase, standaloneMatchAliasExists: h.standalone,
}));

const matchId = '10000000-0000-4000-8000-000000000001';
const owner = { kind: 'phase', phase_id: '20000000-0000-4000-8000-000000000002', season_id: '30000000-0000-4000-8000-000000000003' };

beforeEach(() => vi.resetAllMocks());

it('does not probe a native or standalone owner in the default legacy generation', async () => {
  h.mode.mockResolvedValue('legacy');
  await expect(resolveIdOnlyMatchRoute(matchId)).resolves.toEqual({ kind: 'legacy' });
  expect(h.native).not.toHaveBeenCalled();
  expect(h.legacyPhase).not.toHaveBeenCalled();
  expect(h.standalone).not.toHaveBeenCalled();
});

it('chooses the verified native owner without falling through to another store', async () => {
  h.mode.mockResolvedValue('phase');
  h.native.mockResolvedValue(owner);
  await expect(resolveIdOnlyMatchRoute(matchId)).resolves.toEqual(owner);
  expect(h.native).toHaveBeenCalledExactlyOnceWith({ matchId });
  expect(h.standalone).not.toHaveBeenCalled();
});

it('allows only an explicitly verified standalone match when there is no native owner', async () => {
  h.mode.mockResolvedValue('phase');
  h.standalone.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(resolveIdOnlyMatchRoute(matchId)).resolves.toEqual({ kind: 'legacy' });
  await expect(resolveIdOnlyMatchRoute(matchId)).resolves.toBeNull();
  expect(h.legacyPhase).not.toHaveBeenCalled();
});

it('refuses either phase owner when frozen and never treats it as standalone', async () => {
  h.mode.mockResolvedValue('frozen_phase');
  h.legacyPhase.mockResolvedValueOnce(owner);
  h.native.mockResolvedValueOnce(owner);
  await expect(resolveIdOnlyMatchRoute(matchId)).rejects.toMatchObject({ code: 'phase_storage_unavailable', statusCode: 503 });
  await expect(resolveIdOnlyMatchRoute(matchId)).rejects.toMatchObject({ code: 'phase_storage_unavailable', statusCode: 503 });
  expect(h.native).toHaveBeenCalledTimes(1);
  expect(h.standalone).not.toHaveBeenCalled();
});

it('keeps verified standalone tournaments usable in frozen legacy', async () => {
  h.mode.mockResolvedValue('frozen_legacy');
  h.standalone.mockResolvedValue(true);
  await expect(resolveIdOnlyMatchRoute(matchId)).resolves.toEqual({ kind: 'legacy' });
  expect(h.native).not.toHaveBeenCalled();
});
