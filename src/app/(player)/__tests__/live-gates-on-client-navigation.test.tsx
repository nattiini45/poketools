/**
 * A client navigation inside the (player) segment does not re-render the layout, so every player page gates on the
 * live identity itself (VAL-CROSS-002). A revoked session (`getLiveAccess()` null while the token copy still says
 * signed in) goes to sign-in with the exact path and query the visitor asked for; only a signed-in identity with no
 * linked player gets the not-registered guidance.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const TOURNAMENT_ID = '7c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  getLiveAccess: vi.fn(),
  isSuperadminNow: vi.fn(),
}));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
);
const headerJar = vi.hoisted(() => ({ path: null as string | null }));
const reads = vi.hoisted(() => ({
  getMatchById: vi.fn(),
  getMatchesByPlayer: vi.fn(),
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => auth);
vi.mock('next/navigation', () => ({
  redirect,
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-poketools-path' ? headerJar.path : null) }),
}));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('@/i18n/server', () => ({ getT: async () => (key: string) => key }));
vi.mock('@/lib/pack-extensions', () => ({ siteNavExtraLinks: async () => [] }));
vi.mock('@/components/shared/NavBar', () => ({ default: () => null }));
vi.mock('@/components/shared/PageTransitionWrapper', () => ({ default: () => null }));
vi.mock('@/components/ui/PageContainer', () => ({ default: () => null }));
vi.mock('@/components/ui/Card', () => ({ default: () => null }));
vi.mock('@/components/match/MatchStatusBadge', () => ({ default: () => null }));
vi.mock('@/components/match/GameList', () => ({ default: () => null }));
vi.mock('@/components/match/MatchPrepClient', () => ({ default: () => null }));
vi.mock('@/components/teambuilder/TeambuilderClient', () => ({ default: () => null }));
vi.mock('../dashboard/DashboardContent', () => ({ default: () => null }));
vi.mock('@/lib/supabase/queries/matches', () => reads);
vi.mock('@/lib/supabase/queries/tournaments', () => reads);
vi.mock('@/lib/supabase/queries/players', () => ({ getPlayerById: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({}));
vi.mock('@/lib/supabase/queries/ratings', () => ({}));
vi.mock('@/lib/supabase/queries/streaks', () => ({}));
vi.mock('@/lib/supabase/queries/aggregates', () => ({}));
vi.mock('@/lib/cache/public-reads', () => ({ publicReads: {} }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('@/lib/supabase/queries/teams', () => ({ getPlayerTeamForTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/match-prep-teams', () => ({ getMatchPrepTeam: vi.fn() }));
vi.mock('@/lib/supabase/queries/match-prep-analyses', () => ({ getMatchPrepAnalysis: vi.fn() }));
vi.mock('@/lib/draft/player-pool', () => ({ getInitialPoolForPlayer: vi.fn() }));
vi.mock('server-only', () => ({}));

import PlayerLayout from '../layout';
import DashboardPage from '../dashboard/page';
import BroadcastHubPage from '../dashboard/broadcast/page';
import ConfirmMatchPage from '../dashboard/confirm/[mid]/page';
import MatchPrepPage from '../dashboard/match-prep/[mid]/page';
import TournamentTeambuilderPage from '../teambuilder/[tid]/page';
import TeambuilderPage from '../teambuilder/page';

const mid = { params: Promise.resolve({ mid: MATCH_ID }) };
const tid = { params: Promise.resolve({ tid: TOURNAMENT_ID }) };

async function renderTree(element: unknown): Promise<void> {
  // AuthGuard is an async component: resolve it the way React would.
  const node = element as { type: unknown; props: Record<string, unknown> } | null;
  if (node && typeof node.type === 'function') await (node.type as (p: unknown) => Promise<unknown>)(node.props);
}

const pages: [string, string, () => Promise<unknown>][] = [
  ['dashboard', '/dashboard', () => DashboardPage()],
  ['broadcast hub', '/dashboard/broadcast', () => BroadcastHubPage()],
  ['confirm', `/dashboard/confirm/${MATCH_ID}?from=email`, () => ConfirmMatchPage(mid)],
  ['match prep', `/dashboard/match-prep/${MATCH_ID}?tab=scout`, () => MatchPrepPage(mid)],
  ['tournament teambuilder', `/teambuilder/${TOURNAMENT_ID}?slot=2`, () => TournamentTeambuilderPage(tid)],
  ['teambuilder index', '/teambuilder?team=a', async () => renderTree(TeambuilderPage())],
];

beforeEach(() => {
  vi.clearAllMocks();
  headerJar.path = null;
  // The token copy keeps saying "signed in": only the live read tells the truth.
  auth.getSession.mockResolvedValue({ player: { playerId: 'stale', isAdmin: true } });
  auth.isSuperadminNow.mockResolvedValue(false);
  reads.getMatchById.mockResolvedValue({ id: MATCH_ID, player_1_id: 'stale', player_2_id: 'other' });
  reads.getMatchesByPlayer.mockResolvedValue([]);
  reads.getTournamentById.mockResolvedValue({ id: TOURNAMENT_ID, season_id: null, ruleset_id: null });
});

describe.each(pages)('%s on a client navigation after revocation', (_name, path, render) => {
  it('redirects to sign-in with the exact path and query, before any data read', async () => {
    auth.getLiveAccess.mockResolvedValue(null);
    headerJar.path = path;
    await expect(render()).rejects.toThrow(`redirect:/auth/signin?callbackUrl=${encodeURIComponent(path)}`);
    expect(reads.getMatchById).not.toHaveBeenCalled();
    expect(reads.getMatchesByPlayer).not.toHaveBeenCalled();
    expect(reads.getTournamentById).not.toHaveBeenCalled();
  });
});

describe('the player layout is not the only gate', () => {
  it('still sends a revoked session to sign-in on a hard load', async () => {
    auth.getLiveAccess.mockResolvedValue(null);
    headerJar.path = '/dashboard?x=1';
    await expect(PlayerLayout({ children: null })).rejects.toThrow('redirect:/auth/signin?callbackUrl=%2Fdashboard%3Fx%3D1');
  });
});

describe('a signed-in identity without a linked player', () => {
  beforeEach(() => auth.getLiveAccess.mockResolvedValue({ player: null }));

  it('sees the not-registered guidance on the dashboard and the broadcast hub, not a sign-in redirect', async () => {
    await expect(DashboardPage()).resolves.toBeTruthy();
    await expect(BroadcastHubPage()).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
