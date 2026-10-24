/**
 * The public match detail page: which URL renders a match, and who sees the
 * admin notes. The page runs as a plain async function (vitest 'node' env)
 * and its element tree is walked without rendering the child components.
 *
 * Notes are site-admin data. The gate is the LIVE role read (`getLiveAccess`,
 * AGENTS.md D37), never the session copy: anonymous viewers, players, and
 * resource admins who are not site admins never see them.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fullMatchRow, PRIVATE_MATCH_SENTINELS } from '@/lib/match/__tests__/private-match-fields';

// ─── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getMatchById: vi.fn(),
  getCompletedMatchRecords: vi.fn(),
  getSessionPlayer: vi.fn(),
  getLiveAccess: vi.fn(),
  isResourceAdminFor: vi.fn(),
  listMatchProposals: vi.fn(),
  getGamesByMatch: vi.fn(),
  getMatchAnalysis: vi.fn(),
  getTournamentWithDetails: vi.fn(),
  getMatchSnapshots: vi.fn(),
  getListEntries: vi.fn(),
  getSeasonById: vi.fn(),
  resolveContentLocale: vi.fn(),
  locale: { current: 'en' as 'en' | 'de' },
  // The Pokémon-name locale; null follows the UI locale.
  dataLocale: { current: null as 'en' | 'de' | null },
}));

// The viewer's language comes from the cookie (no request here): pinned per test.
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => mocks.locale.current,
    getDataLocale: async () => mocks.dataLocale.current ?? mocks.locale.current,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale.current),
  };
});
vi.mock('@/i18n/content-locale', () => ({ resolveContentLocale: mocks.resolveContentLocale }));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: mocks.getMatchById,
  getCompletedMatchRecords: mocks.getCompletedMatchRecords,
}));
vi.mock('@/lib/supabase/queries/match-proposals', () => ({ listMatchProposals: mocks.listMatchProposals }));
vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(async () => ({})),
  getGamesByMatch: mocks.getGamesByMatch,
}));
vi.mock('@/lib/supabase/queries/match-analyses', () => ({ getMatchAnalysis: mocks.getMatchAnalysis }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentWithDetails: mocks.getTournamentWithDetails,
  getParticipants: vi.fn(async () => []),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(async () => ({ id: 'round-1', name: 'Round 1', best_of: 3, deadline: null })),
}));
vi.mock('@/lib/supabase/queries/streaks', () => ({ getPlayerStreaks: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
vi.mock('@/lib/tournament/season-standings', () => ({ computeStandingsForSeason: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/queries/match-snapshots', () => ({ getMatchSnapshots: mocks.getMatchSnapshots }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: mocks.getListEntries }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: mocks.getSeasonById }));
vi.mock('@/lib/supabase/queries/epb-animation-views', () => ({ hasViewedEpbReplay: vi.fn(async () => false) }));
vi.mock('@/lib/auth/helpers', () => ({
  getSessionPlayer: mocks.getSessionPlayer,
  getLiveAccess: mocks.getLiveAccess,
}));
vi.mock('@/components/match/MatchHighlightCard', () => ({ default: () => null }));
vi.mock('@/components/match/ExportCardButton', () => ({ default: () => null }));
vi.mock('@/components/match/CreateSocialImageButton', () => ({ default: () => null }));
vi.mock('@/components/evolution/MatchEvolutionSummary', () => ({ default: () => null }));
vi.mock('@/components/evolution/EpbPokemonRow', () => ({ default: () => null }));
vi.mock('@/components/evolution/MatchEvolutionReplay', () => ({ default: () => null }));
vi.mock('@/components/match/GameDetailCard', () => ({ default: () => null }));
vi.mock('@/components/match/MatchAnalysisCard', () => ({ default: () => null }));
vi.mock('@/components/match/MatchSchedulingPanel', () => ({ default: () => null }));

import MatchDetailPage from '../page';
import CreateSocialImageButton from '@/components/match/CreateSocialImageButton';
import EpbPokemonRow from '@/components/evolution/EpbPokemonRow';

// ─── Helpers ────────────────────────────────────────────────────────

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TOURNAMENT_ID = '22222222-2222-4222-8222-222222222222';
const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const NOTES = PRIVATE_MATCH_SENTINELS.notes;

function params(id: string, mid: string) {
  return { params: Promise.resolve({ id, mid }) };
}

/** Every string rendered anywhere in an element tree (props.children only). */
function textsOf(node: ReactNode, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => textsOf(n, out));
  } else if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
  } else if (isValidElement<{ children?: ReactNode; action?: ReactNode }>(node)) {
    textsOf(node.props.children, out);
    textsOf(node.props.action, out);
  }
  return out;
}

async function renderPage(id = TOURNAMENT_ID, mid = MATCH_ID) {
  const tree = await MatchDetailPage(params(id, mid));
  return textsOf(tree);
}

function signedIn(overrides: { isAdmin?: boolean } = {}) {
  mocks.getSessionPlayer.mockResolvedValue({
    playerId: 'viewer-1',
    name: 'Viewer',
    isAdmin: overrides.isAdmin ?? false,
  });
}

function liveAccess(access: { isSiteAdmin: boolean; isAnyAdmin: boolean }) {
  mocks.getLiveAccess.mockResolvedValue({
    player: { playerId: 'viewer-1' },
    isCreator: false,
    ...access,
  });
}

const STANDARD_TOURNAMENT = {
  id: TOURNAMENT_ID,
  name: 'Spring Cup',
  season_id: null,
  season_name: null,
  season_format_type: 'standard',
  ruleset_name: 'Gen 9 OU',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale.current = 'en';
  mocks.dataLocale.current = null;
  mocks.getMatchAnalysis.mockResolvedValue(null);
  mocks.getTournamentWithDetails.mockResolvedValue(STANDARD_TOURNAMENT);
  mocks.getMatchSnapshots.mockResolvedValue([]);
  mocks.getListEntries.mockResolvedValue([]);
  mocks.getSeasonById.mockResolvedValue(null);
  mocks.resolveContentLocale.mockResolvedValue('de');
  mocks.getMatchById.mockResolvedValue(
    fullMatchRow({ id: MATCH_ID, tournament_id: TOURNAMENT_ID, games: [] }),
  );
  mocks.getCompletedMatchRecords.mockResolvedValue([]);
  mocks.getSessionPlayer.mockResolvedValue(null);
  mocks.getLiveAccess.mockResolvedValue(null);
  mocks.isResourceAdminFor.mockResolvedValue(false);
  mocks.listMatchProposals.mockResolvedValue([]);
  mocks.getGamesByMatch.mockResolvedValue([]);
});

// ─── URL ↔ match ────────────────────────────────────────────────────

describe('MatchDetailPage: which URL renders the match', () => {
  it('renders the match under its own tournament', async () => {
    const texts = await renderPage();
    expect(texts).toContain('No games played yet.');
  });

  it('surfaces a failed analysis read to the error boundary instead of rendering "no analysis"', async () => {
    mocks.getMatchAnalysis.mockRejectedValueOnce(new Error('analysis read failed'));
    await expect(renderPage()).rejects.toThrow('analysis read failed');
  });

  it('404s a match requested under another tournament', async () => {
    await expect(renderPage(OTHER_TOURNAMENT_ID, MATCH_ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s an unknown match', async () => {
    mocks.getMatchById.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each([
    ['a malformed match id', TOURNAMENT_ID, 'abc'],
    ['a malformed tournament id', 'abc', MATCH_ID],
  ])('404s %s without querying the database', async (_label, id, mid) => {
    await expect(renderPage(id, mid)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getMatchById).not.toHaveBeenCalled();
  });
});

// ─── Admin notes gate ───────────────────────────────────────────────

describe('MatchDetailPage: admin notes', () => {
  it('anonymous: no notes, and no live role read', async () => {
    const texts = await renderPage();

    expect(texts).not.toContain(NOTES);
    expect(texts).not.toContain('Notes');
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
  });

  it('a player who is no admin: no notes', async () => {
    signedIn();
    liveAccess({ isSiteAdmin: false, isAnyAdmin: false });

    const texts = await renderPage();

    expect(texts).not.toContain(NOTES);
    expect(mocks.getLiveAccess).toHaveBeenCalledTimes(1);
  });

  it('a resource admin who is not a site admin: no notes', async () => {
    signedIn();
    liveAccess({ isSiteAdmin: false, isAnyAdmin: true });
    mocks.isResourceAdminFor.mockResolvedValue(true);

    const texts = await renderPage();

    expect(texts).not.toContain(NOTES);
  });

  it('a stale session copy that still says admin, revoked live: no notes', async () => {
    signedIn({ isAdmin: true });
    liveAccess({ isSiteAdmin: false, isAnyAdmin: false });

    const texts = await renderPage();

    expect(texts).not.toContain(NOTES);
  });

  it('a site admin (live): sees the notes', async () => {
    signedIn({ isAdmin: true });
    liveAccess({ isSiteAdmin: true, isAnyAdmin: true });

    const texts = await renderPage();

    expect(texts).toContain('Notes');
    expect(texts).toContain(NOTES);
  });

  it('a match without notes costs no live role read', async () => {
    signedIn({ isAdmin: true });
    mocks.getMatchById.mockResolvedValue(
      fullMatchRow({ id: MATCH_ID, tournament_id: TOURNAMENT_ID, games: [], notes: '' }),
    );

    const texts = await renderPage();

    expect(texts).not.toContain('Notes');
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
  });

  it('a failed live role read fails closed (rethrows)', async () => {
    signedIn({ isAdmin: true });
    mocks.getLiveAccess.mockRejectedValue(new Error('db down'));

    await expect(renderPage()).rejects.toThrow('db down');
  });
});

// ─── Language (i18n T07) ────────────────────────────────────────────

/** Every element in a tree (props.children and props.action), depth first. */
function elementsOf(node: ReactNode, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => elementsOf(n, out));
  } else if (isValidElement<{ children?: ReactNode; action?: ReactNode }>(node)) {
    out.push(node as ReactElement<Record<string, unknown>>);
    elementsOf(node.props.children, out);
    elementsOf(node.props.action, out);
  }
  return out;
}

describe('MatchDetailPage: language', () => {
  it('renders its labels in the viewer language', async () => {
    mocks.locale.current = 'de';
    const texts = await renderPage();
    expect(texts).toContain('Noch keine Partien gespielt.');
    expect(texts).toContain('Zurück zum Turnier');
  });

  it('reads the league language only when something uses it', async () => {
    await renderPage();
    expect(mocks.resolveContentLocale).not.toHaveBeenCalled();
  });

  it('gives the social-image button a league-language copy of the card when the admin reads another language', async () => {
    signedIn({ isAdmin: true });
    liveAccess({ isSiteAdmin: true, isAnyAdmin: true });
    mocks.getTournamentWithDetails.mockResolvedValue({ ...STANDARD_TOURNAMENT, season_id: 'season-1' });

    const tree = await MatchDetailPage(params(TOURNAMENT_ID, MATCH_ID));
    const button = elementsOf(tree).find((el) => el.type === CreateSocialImageButton);

    expect(mocks.resolveContentLocale).toHaveBeenCalledWith({ seasonId: 'season-1' });
    expect(button?.props.contentLocale).toBe('de');
    expect(button?.props.contentTargetId).toBe('match-social-highlight-card');
    const copy = button?.props.contentCard as ReactElement<{ idPrefix?: string; forCapture?: boolean }>;
    expect(copy.props.idPrefix).toBe('match-social');
    expect(copy.props.forCapture).toBe(true);
  });

  it('sends no copy when the admin already reads the league language', async () => {
    mocks.locale.current = 'de';
    signedIn({ isAdmin: true });
    liveAccess({ isSiteAdmin: true, isAnyAdmin: true });

    const tree = await MatchDetailPage(params(TOURNAMENT_ID, MATCH_ID));
    const button = elementsOf(tree).find((el) => el.type === CreateSocialImageButton);

    expect(button?.props.contentLocale).toBe('de');
    expect(button?.props.contentCard).toBeUndefined();
  });

  it('sends the copy when the admin reads the league language but keeps Pokémon names in English', async () => {
    mocks.locale.current = 'de';
    mocks.dataLocale.current = 'en';
    signedIn({ isAdmin: true });
    liveAccess({ isSiteAdmin: true, isAnyAdmin: true });

    const tree = await MatchDetailPage(params(TOURNAMENT_ID, MATCH_ID));
    const button = elementsOf(tree).find((el) => el.type === CreateSocialImageButton);

    expect(button?.props.contentLocale).toBe('de');
    expect(button?.props.contentTargetId).toBe('match-social-highlight-card');
    const copy = button?.props.contentCard as ReactElement<{ idPrefix?: string }>;
    expect(copy.props.idPrefix).toBe('match-social');
  });
});

// ─── EPB line keying ────────────────────────────────────────────────

describe('MatchDetailPage: EPB rows are keyed by line id', () => {
  const entry = (stage3: string, price: number) => ({
    id: `e-${stage3}`,
    list_version_id: 'v1',
    line_number: 1,
    base_pokemon: 'Oshawott',
    stage2_pokemon: 'Dewott',
    stage3_pokemon: stage3,
    price,
    kills_to_stage2: 3,
    additional_kills_to_stage3: 4,
    price_group: 'mittel',
  });
  const snapshot = (id: string, species: string) => ({
    id,
    match_id: MATCH_ID,
    player_id: 'player-1',
    tracker_id: null,
    base_pokemon: 'Oshawott',
    species_at_match: species,
    stage_at_match: 3,
    progress_before: 7,
    progress_after: 7,
    real_kos: 0,
    draft_tokens_delta: 0,
    kill_tokens_delta: 0,
    cosmo_points_delta: 0,
    evolution_triggered: false,
    suspension_triggered: false,
    brought: true,
    created_at: '2026-03-01T18:00:00.000Z',
  });

  it('gives two lines with one base their own list entry', async () => {
    mocks.getTournamentWithDetails.mockResolvedValue({
      ...STANDARD_TOURNAMENT,
      season_id: 'season-1',
      season_format_type: 'evolution_point_buy',
    });
    mocks.getSeasonById.mockResolvedValue({ id: 'season-1', point_buy_list_id: 'list-1' });
    mocks.getListEntries.mockResolvedValue([entry('Samurott', 12), entry('Samurott-Hisui', 18)]);
    mocks.getMatchSnapshots.mockResolvedValue([snapshot('s1', 'Samurott'), snapshot('s2', 'Samurott-Hisui')]);

    const tree = await MatchDetailPage(params(TOURNAMENT_ID, MATCH_ID));
    const rows = elementsOf(tree).filter((el) => el.type === EpbPokemonRow);
    const priceOf = (id: string) =>
      rows.find((r) => (r.props.snapshot as { id: string }).id === id)?.props.price;

    expect(priceOf('s1')).toBe(12);
    expect(priceOf('s2')).toBe(18);
  });
});

// ─── Inline game editor: the editor's game version ──────────────────

describe('MatchDetailPage: inline game editor version', () => {
  const GAME_ID = '44444444-4444-4444-8444-444444444444';
  const VERSION = '2026-10-19T08:00:00.123456+00:00';

  /** Every element in the tree whose props carry `canEdit` (the game cards). */
  function gameCards(node: ReactNode, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
    if (Array.isArray(node)) {
      node.forEach((n) => gameCards(n, out));
    } else if (isValidElement<Record<string, unknown> & { children?: ReactNode }>(node)) {
      if ('canEdit' in node.props) out.push(node.props);
      gameCards(node.props.children, out);
    }
    return out;
  }

  beforeEach(() => {
    mocks.getMatchById.mockResolvedValue(
      fullMatchRow({
        id: MATCH_ID,
        tournament_id: TOURNAMENT_ID,
        games: [{ id: GAME_ID, game_number: 1, winner_id: null, replay_url: '', source: 'manual', stats_locked: false }],
      }),
    );
    mocks.getGamesByMatch.mockResolvedValue([{ id: GAME_ID, updated_at: VERSION }]);
  });

  it('gives an editor the version read BEFORE the match and its stats', async () => {
    signedIn({ isAdmin: true });
    const cards = gameCards(await MatchDetailPage(params(TOURNAMENT_ID, MATCH_ID)));

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ canEdit: true, editVersion: VERSION, isSiteAdmin: true });
    expect(mocks.getGamesByMatch).toHaveBeenCalledWith(MATCH_ID);
    expect(mocks.getGamesByMatch.mock.invocationCallOrder[0]).toBeLessThan(mocks.getMatchById.mock.invocationCallOrder[0]);
  });

  it('gives a tournament admin the version without the site-admin flag', async () => {
    signedIn();
    mocks.isResourceAdminFor.mockResolvedValue(true);
    const cards = gameCards(await MatchDetailPage(params(TOURNAMENT_ID, MATCH_ID)));

    expect(cards[0]).toMatchObject({ canEdit: true, editVersion: VERSION, isSiteAdmin: false });
  });

  it('passes no version to a signed-in viewer who cannot edit', async () => {
    signedIn();
    const cards = gameCards(await MatchDetailPage(params(TOURNAMENT_ID, MATCH_ID)));

    expect(cards[0]).toMatchObject({ canEdit: false, editVersion: undefined });
  });

  it('reads no versions for an anonymous viewer', async () => {
    const cards = gameCards(await MatchDetailPage(params(TOURNAMENT_ID, MATCH_ID)));

    expect(cards[0]).toMatchObject({ canEdit: false, editVersion: undefined });
    expect(mocks.getGamesByMatch).not.toHaveBeenCalled();
  });
});
