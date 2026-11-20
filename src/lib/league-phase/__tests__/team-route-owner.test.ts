import { beforeEach, expect, it, vi } from 'vitest';
import { resolveIdOnlyTeamRoute } from '../team-route-owner';

const h = vi.hoisted(() => ({ mode: vi.fn(), native: vi.fn() }));
vi.mock('../route-mode', () => ({ getPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPhaseTeamById: h.native }));

const teamId = '10000000-0000-4000-8000-000000000001';
const team = { id: teamId, phase_id: '20000000-0000-4000-8000-000000000002', player_id: 'x', season_id: null };

beforeEach(() => vi.resetAllMocks());

it('does not probe the phase store in the default legacy generation', async () => {
  h.mode.mockResolvedValue('legacy');
  await expect(resolveIdOnlyTeamRoute(teamId)).resolves.toEqual({ kind: 'legacy' });
  expect(h.native).not.toHaveBeenCalled();
});

it('answers the native phase team when the phase store holds the id', async () => {
  h.mode.mockResolvedValue('phase');
  h.native.mockResolvedValue(team);
  await expect(resolveIdOnlyTeamRoute(teamId)).resolves.toEqual({ kind: 'phase', team });
  expect(h.native).toHaveBeenCalledExactlyOnceWith(teamId);
});

it('keeps a standalone team on the legacy path, and a malformed id names no owner', async () => {
  h.mode.mockResolvedValue('phase');
  h.native.mockResolvedValue(null);
  await expect(resolveIdOnlyTeamRoute(teamId)).resolves.toEqual({ kind: 'legacy' });
  expect(await resolveIdOnlyTeamRoute('x\' OR 1=1')).toBeNull();
  expect(h.native).toHaveBeenCalledOnce();
});

it('refuses a native row while the storage is frozen mid-transfer, and never falls through to the legacy row', async () => {
  h.native.mockResolvedValue(team);
  for (const mode of ['frozen_phase', 'frozen_legacy']) {
    h.mode.mockResolvedValue(mode);
    await expect(resolveIdOnlyTeamRoute(teamId)).rejects.toMatchObject({ code: 'phase_storage_unavailable', statusCode: 503 });
  }
});

it('keeps a standalone team usable in a freeze', async () => {
  h.mode.mockResolvedValue('frozen_legacy');
  h.native.mockResolvedValue(null);
  await expect(resolveIdOnlyTeamRoute(teamId)).resolves.toEqual({ kind: 'legacy' });
});
