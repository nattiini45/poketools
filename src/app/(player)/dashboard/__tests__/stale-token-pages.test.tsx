/**
 * The (player) layout lets an authenticated identity with no linked player through, so every page under it that acts
 * for a player reads the live player, never the up-to-5-minute token copy: a player link removed while the token is
 * still valid must not keep opening match prep, confirmation or the dashboard data for the old player id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MATCH_ID = '33333333-3333-4333-8333-333333333333';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSessionPlayer: vi.fn(),
  getLiveAccess: vi.fn(),
  isSuperadminNow: vi.fn(),
}));
const reads = vi.hoisted(() => ({
  getMatchById: vi.fn(),
  getMatchesByPlayer: vi.fn(),
  getPlayerById: vi.fn(),
}));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
);

vi.mock('@/lib/auth/helpers', () => auth);
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }));
vi.mock('next/navigation', () => ({ redirect, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('@/i18n/server', () => ({ getT: async () => (key: string) => key }));
vi.mock('@/i18n/content-locale', () => ({ resolveContentLocale: async () => 'en' }));
vi.mock('@/components/shared/AuthGuard', () => ({ default: () => null }));
vi.mock('@/components/ui/PageContainer', () => ({ default: () => null }));
vi.mock('@/components/ui/Card', () => ({ default: () => null }));
vi.mock('@/components/match/MatchStatusBadge', () => ({ default: () => null }));
vi.mock('@/components/match/GameList', () => ({ default: () => null }));
vi.mock('@/components/match/MatchPrepClient', () => ({ default: () => null }));
vi.mock('@/lib/supabase/queries/matches', () => reads);
vi.mock('@/lib/supabase/queries/players', () => reads);

import BroadcastHubPage from '../broadcast/page';
import ConfirmMatchPage from '../confirm/[mid]/page';
import MatchPrepPage from '../match-prep/[mid]/page';

const params = { params: Promise.resolve({ mid: MATCH_ID }) };

const pages: [string, () => Promise<unknown>][] = [
  ['confirm', () => ConfirmMatchPage(params)],
  ['match-prep', () => MatchPrepPage(params)],
];

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ player: { playerId: 'stale', isAdmin: true } });
  auth.getSessionPlayer.mockResolvedValue({ playerId: 'stale', isAdmin: true });
  auth.isSuperadminNow.mockResolvedValue(false);
  reads.getMatchById.mockResolvedValue({ id: MATCH_ID, player_1_id: 'stale', player_2_id: 'other' });
  reads.getMatchesByPlayer.mockResolvedValue([]);
});

describe.each(pages)('%s page', (_name, render) => {
  it('does not open for a valid token whose player link is gone', async () => {
    auth.getLiveAccess.mockResolvedValue({ player: null });
    await expect(render()).rejects.toThrow('redirect:/');
    expect(reads.getMatchById).not.toHaveBeenCalled();
  });
});

describe('broadcast hub', () => {
  it('shows the not-registered note and reads no matches for a stale token player', async () => {
    auth.getLiveAccess.mockResolvedValue({ player: null });
    await BroadcastHubPage();
    expect(reads.getMatchesByPlayer).not.toHaveBeenCalled();
  });

  it('reads the matches of the live player id', async () => {
    auth.getLiveAccess.mockResolvedValue({ player: { playerId: 'live' } });
    await BroadcastHubPage();
    expect(reads.getMatchesByPlayer).toHaveBeenCalledWith('live');
  });
});