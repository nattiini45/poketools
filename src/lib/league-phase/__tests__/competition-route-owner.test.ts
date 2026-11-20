import { beforeEach, expect, it, vi } from 'vitest';
import { resolveIdOnlyCompetitionRoute } from '../competition-route-owner';

const h = vi.hoisted(() => ({ mode: vi.fn(), native: vi.fn(), legacyPhase: vi.fn(), standalone: vi.fn() }));
vi.mock('../route-mode', () => ({ getPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: h.native, findLegacyPhaseAliasOwner: h.legacyPhase, standaloneTournamentAliasExists: h.standalone,
}));

const phaseId = '10000000-0000-4000-8000-000000000001';
const owner = { kind: 'phase', phase_id: phaseId, season_id: '30000000-0000-4000-8000-000000000003' };

beforeEach(() => vi.resetAllMocks());

it('does not probe a native or standalone owner in the default legacy generation', async () => {
  h.mode.mockResolvedValue('legacy');
  await expect(resolveIdOnlyCompetitionRoute(phaseId)).resolves.toEqual({ kind: 'legacy' });
  expect(h.native).not.toHaveBeenCalled();
  expect(h.legacyPhase).not.toHaveBeenCalled();
  expect(h.standalone).not.toHaveBeenCalled();
});

it('chooses the verified native phase without falling through to another store', async () => {
  h.mode.mockResolvedValue('phase');
  h.native.mockResolvedValue(owner);
  await expect(resolveIdOnlyCompetitionRoute(phaseId)).resolves.toEqual(owner);
  expect(h.native).toHaveBeenCalledExactlyOnceWith({ phaseId });
  expect(h.standalone).not.toHaveBeenCalled();
});

it('allows only an explicitly verified standalone tournament when there is no native phase', async () => {
  h.mode.mockResolvedValue('phase');
  h.standalone.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(resolveIdOnlyCompetitionRoute(phaseId)).resolves.toEqual({ kind: 'legacy' });
  await expect(resolveIdOnlyCompetitionRoute(phaseId)).resolves.toBeNull();
  expect(h.legacyPhase).not.toHaveBeenCalled();
});

it('refuses either phase owner when frozen and never treats it as standalone', async () => {
  h.mode.mockResolvedValue('frozen_phase');
  h.legacyPhase.mockResolvedValueOnce(owner);
  h.native.mockResolvedValueOnce(owner);
  await expect(resolveIdOnlyCompetitionRoute(phaseId)).rejects.toMatchObject({ code: 'phase_storage_unavailable', statusCode: 503 });
  await expect(resolveIdOnlyCompetitionRoute(phaseId)).rejects.toMatchObject({ code: 'phase_storage_unavailable', statusCode: 503 });
  expect(h.standalone).not.toHaveBeenCalled();
});

it('keeps a standalone tournament usable in frozen legacy', async () => {
  h.mode.mockResolvedValue('frozen_legacy');
  h.standalone.mockResolvedValue(true);
  await expect(resolveIdOnlyCompetitionRoute(phaseId)).resolves.toEqual({ kind: 'legacy' });
});
