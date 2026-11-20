/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from 'next-auth';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CreatorGuard from '@/components/shared/CreatorGuard';
import { SessionRevokedError } from '@/lib/auth/session-epoch';
import type { PhaseStorageMode } from '@/lib/supabase/queries/phase-storage';
import type { PublicCompetitionMatch } from '@/lib/match/public-match';
import { withI18n } from '@/test/i18n';
import type { SessionPlayer } from '@/types/auth';
import ContentPage from '../page';

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<Session | null>>(),
  loadSessionPlayer: vi.fn<() => Promise<SessionPlayer | null>>(),
  getPhaseRouteMode: vi.fn<() => Promise<PhaseStorageMode>>(),
  listContentMatches: vi.fn<() => Promise<PublicCompetitionMatch[]>>(),
  listSeasons: vi.fn(async () => []),
  getPresetsByOwner: vi.fn(async () => []),
  listDraftPools: vi.fn(async () => []),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth, loadSessionPlayer: mocks.loadSessionPlayer }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-poketools-path': '/content' }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: mocks.getPhaseRouteMode }));
vi.mock('@/lib/supabase/queries/creator-content', () => ({ listContentMatches: mocks.listContentMatches }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ listSeasons: mocks.listSeasons }));
vi.mock('@/lib/supabase/queries/broadcast-presets', () => ({ getPresetsByOwner: mocks.getPresetsByOwner }));
vi.mock('@/lib/supabase/queries/drafts', () => ({ listDraftPools: mocks.listDraftPools }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: vi.fn(() => { throw new Error('unexpected DB read'); }) } }));

const live: SessionPlayer = {
  playerId: 'live-player', name: 'Orbit', isCreator: true, isAdmin: false, isResourceAdmin: false,
  status: 'active', psUsername: '', championsUsername: '', avatarUrl: null,
};
const matchId = '10000000-0000-4000-8000-000000000001';
const nativeMatch: PublicCompetitionMatch = {
  id: matchId, phase_id: 'phase', season_id: 'league', round_id: 'round', player_1_id: 'p1', player_2_id: 'p2',
  player_1_name: 'Orbit', player_2_name: 'Kite', player_1_avatar_url: null, player_2_avatar_url: null,
  winner_id: null, winner_name: null, status: 'scheduled', round_status: 'pending', games: [],
  scheduled_at: null, date_played: null, social_image_url: null, bracket_pos: null, bracket_side: null,
  created_at: '2026-11-19T00:00:00Z', updated_at: '2026-11-19T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    expires: '2099-01-01', provider: 'credentials', user: { id: 'test-identity' },
    player: { ...live, playerId: 'stale-player', isAdmin: true },
  });
  mocks.loadSessionPlayer.mockResolvedValue(live);
  mocks.getPhaseRouteMode.mockResolvedValue('phase');
  mocks.listContentMatches.mockResolvedValue([nativeMatch]);
});

async function renderPage() {
  const page = await ContentPage();
  expect(page.type).toBe(CreatorGuard);
  return render(withI18n(await CreatorGuard(page.props as { children: ReactNode })));
}

function expectNoListReads() {
  for (const query of [mocks.getPhaseRouteMode, mocks.listContentMatches, mocks.listSeasons,
    mocks.getPresetsByOwner, mocks.listDraftPools]) {
    expect(query).not.toHaveBeenCalled();
  }
}

describe('/content creator access', () => {
  it.each([
    { isCreator: false },
    { status: 'banned' as const },
    { status: 'suspended' as const },
  ])('denies the actual viewer before reading any dashboard data despite the stale creator/admin token: %j', async (change) => {
    mocks.loadSessionPlayer.mockResolvedValue({ ...live, ...change });
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Access Denied' })).toBeTruthy();
    expect(screen.queryByText('Overlay URL Builder')).toBeNull();
    expectNoListReads();
  });

  it('preserves the sign-in callback for signed-out viewers', async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('redirect:/auth/signin?callbackUrl=%2Fcontent');
    expectNoListReads();
  });

  it('preserves the sign-in callback for revoked sessions', async () => {
    mocks.loadSessionPlayer.mockRejectedValue(new SessionRevokedError());
    await expect(renderPage()).rejects.toThrow('redirect:/auth/signin?callbackUrl=%2Fcontent');
    expectNoListReads();
  });

  it('fails closed when live authorization cannot be checked', async () => {
    mocks.loadSessionPlayer.mockRejectedValue(new Error('live identity unavailable'));
    await expect(renderPage()).rejects.toThrow('live identity unavailable');
    expectNoListReads();
  });

  it.each(['phase', 'frozen_phase'] as const)('shows the native match to the live creator in %s with the existing controls and links', async (mode) => {
    mocks.getPhaseRouteMode.mockResolvedValue(mode);
    await renderPage();
    expect(mocks.getPresetsByOwner).toHaveBeenCalledExactlyOnceWith('live-player');
    expect(mocks.listContentMatches).toHaveBeenCalledExactlyOnceWith(mode);
    expect(mocks.listSeasons).toHaveBeenCalledExactlyOnceWith({ storage: 'phase' });
    expect(screen.getByText('1 active match ready to track')).toBeTruthy();
    expect(screen.getByRole('link', { name: /open tracker/i }).getAttribute('href')).toBe('/dashboard/broadcast');
    expect(within(screen.getByRole('combobox', { name: 'Match' })).getByRole('option', { name: 'Orbit vs Kite' })).toBeTruthy();

    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /open tracker/i }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Overlay Type' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Overlay Type' }), 'match_preview');
    await user.tab();
    const overlayMatches = screen.getAllByRole('combobox', { name: 'Match' })[0];
    expect(document.activeElement).toBe(overlayMatches);
    await user.selectOptions(overlayMatches, matchId);
    const preview = screen.getByRole('link', { name: /open preview/i });
    expect(new URL(preview.getAttribute('href') ?? '', window.location.origin).pathname)
      .toBe(`/broadcast/match/${matchId}/preview`);
  });

  it('allows a live site admin without a creator flag and keeps frozen-legacy lists selected', async () => {
    mocks.loadSessionPlayer.mockResolvedValue({ ...live, isAdmin: true, isCreator: false });
    mocks.getPhaseRouteMode.mockResolvedValue('frozen_legacy');
    await renderPage();
    expect(screen.getByText('Overlay URL Builder')).toBeTruthy();
    expect(mocks.listContentMatches).toHaveBeenCalledExactlyOnceWith('frozen_legacy');
    expect(mocks.listSeasons).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});
