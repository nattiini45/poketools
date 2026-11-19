import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

const q = vi.hoisted(() => ({
  auth: vi.fn(), mode: vi.fn(), legacy: vi.fn(), standalone: vi.fn(), phase: vi.fn(),
}));
vi.mock('@/lib/auth/redirect-to-sign-in', () => ({ requireLiveIdentityOrSignIn: q.auth }));
vi.mock('@/components/shared/AuthGuard', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: q.mode }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchesByPlayer: q.legacy }));
vi.mock('@/lib/supabase/queries/dashboard-now', () => ({
  listDashboardPhaseMatches: q.phase, listStandaloneDashboardMatches: q.standalone,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import BroadcastHubPage from '../page';

const ACTIVE = {
  id: 'native-match', status: 'scheduled', player_1_name: 'Fixture Aster', player_2_name: 'Fixture Birch',
  player_1_id: 'p1', player_2_id: 'p2', winner_id: null,
  date_played: null, created_at: '2026-11-01T08:00:00Z',
};
const STANDALONE = { ...ACTIVE, id: 'standalone-match', player_1_name: 'Fixture Clover' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
  q.auth.mockResolvedValue({ player: { playerId: 'p1' } });
  q.mode.mockResolvedValue('phase');
  q.phase.mockResolvedValue([ACTIVE]);
  q.standalone.mockResolvedValue([STANDALONE]);
  q.legacy.mockResolvedValue([{ ...STANDALONE, id: 'legacy-match' }]);
});
afterEach(() => vi.unstubAllEnvs());

it('links active native and standalone matches to the existing tracker URL', async () => {
  const markup = renderToStaticMarkup(await BroadcastHubPage());
  expect(markup).toContain('href="/dashboard/broadcast/native-match"');
  expect(markup).toContain('href="/dashboard/broadcast/standalone-match"');
  expect(q.phase).toHaveBeenCalledExactlyOnceWith('p1');
  expect(q.standalone).toHaveBeenCalledExactlyOnceWith('p1');
  expect(q.legacy).not.toHaveBeenCalled();
});

it('keeps the legacy list when the flag is off', async () => {
  vi.stubEnv('READ_PHASE_STORAGE_STATE', undefined);
  const markup = renderToStaticMarkup(await BroadcastHubPage());
  expect(markup).toContain('href="/dashboard/broadcast/legacy-match"');
  expect(markup).not.toContain('native-match');
  expect(q.mode).not.toHaveBeenCalled();
  expect(q.phase).not.toHaveBeenCalled();
});

it('refuses frozen hub reads without returning stale links', async () => {
  q.mode.mockResolvedValue('frozen_phase');
  await expect(BroadcastHubPage()).rejects.toMatchObject({ code: 'phase_storage_unavailable' });
  expect(q.phase).not.toHaveBeenCalled();
  expect(q.standalone).not.toHaveBeenCalled();
  expect(q.legacy).not.toHaveBeenCalled();
});
