import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fullMatchRow } from '@/lib/match/__tests__/private-match-fields';
import { toPublicMatch } from '@/lib/match/public-match';

const mock = vi.hoisted(() => ({
  mode: vi.fn(),
  legacyOwner: vi.fn(),
  nativeOwner: vi.fn(),
  legacyMatch: vi.fn(),
  renderLegacy: vi.fn(),
  nativeMatch: vi.fn(),
  phase: vi.fn(),
  phaseRounds: vi.fn(),
  phaseMatches: vi.fn(),
  phaseParticipants: vi.fn(),
  context: vi.fn(),
  standings: vi.fn(),
  gameStats: vi.fn(),
  analysis: vi.fn(),
  contentLocale: vi.fn(),
  streaks: vi.fn(),
  access: vi.fn(),
  privateMatch: vi.fn(),
  proposals: vi.fn(),
  snapshots: vi.fn(),
  replayViewed: vi.fn(),
  season: vi.fn(),
  listEntries: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getT: (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
    getLocale: () => 'en',
    getDataLocale: () => 'en',
  };
});
vi.mock('@/i18n/content-locale', () => ({ resolveContentLocale: mock.contentLocale }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: mock.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  resolveLeaguePhaseRoute: mock.legacyOwner, findNativePhaseAliasOwner: mock.nativeOwner,
}));
vi.mock('@/lib/cache/phase-public-reads', () => ({
  phasePublicReads: {
    match: mock.nativeMatch, detail: mock.phase, rounds: mock.phaseRounds, matches: mock.phaseMatches,
    participants: mock.phaseParticipants,
  },
}));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: mock.legacyMatch }));
vi.mock('@/lib/match/render-legacy-match-detail', () => ({ renderLegacyMatchDetail: mock.renderLegacy }));
vi.mock('@/lib/league-phase/standings-context', () => ({ loadNativeSeasonStandingsContext: mock.context }));
vi.mock('@/lib/tournament/season-standings', () => ({ computeStandingsFromContext: mock.standings }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseBattleStatsByMatch: mock.gameStats }));
vi.mock('@/lib/supabase/queries/phase-ai-artifacts', () => ({ getPhaseMatchAnalysis: mock.analysis }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: mock.privateMatch }));
vi.mock('@/lib/supabase/queries/match-proposals', () => ({ listPhaseMatchProposals: mock.proposals }));
vi.mock('@/lib/supabase/queries/streaks', () => ({ getPlayerStreaks: mock.streaks }));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mock.access }));
vi.mock('@/lib/supabase/queries/phase-epb-animation-views', () => ({ hasViewedPhaseEpbReplay: mock.replayViewed }));
vi.mock('@/lib/supabase/queries/phase-match-snapshots', () => ({ getPhaseMatchSnapshots: mock.snapshots }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: mock.season }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: mock.listEntries }));

import Page, { generateMetadata } from '../page';
import MatchHighlightCard from '@/components/match/MatchHighlightCard';
import MatchAnalysisCard from '@/components/match/MatchAnalysisCard';
import MatchSchedulingPanel from '@/components/match/MatchSchedulingPanel';
import GameDetailCard from '@/components/match/GameDetailCard';
import CreateSocialImageButton from '@/components/match/CreateSocialImageButton';
import MatchEvolutionReplay from '@/components/evolution/MatchEvolutionReplay';

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const PHASE = '22222222-2222-4222-8222-222222222222';
const MATCH = '33333333-3333-4333-8333-333333333333';
const OTHER = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const PHASE_HREF = '/leagues/' + LEAGUE + '/phases/' + PHASE;
const MATCH_HREF = PHASE_HREF + '/matches/' + MATCH;
const GAME = { id: 'game-1', game_number: 1, winner_id: 'player-1', replay_url: '', source: 'manual', stats_locked: false } as const;
const LEGACY_MATCH = fullMatchRow({ id: MATCH, tournament_id: PHASE, status: 'completed', games: [GAME] });
const { tournament_id: legacyPhase, ...projection } = toPublicMatch(LEGACY_MATCH);
const NATIVE_MATCH = { ...projection, phase_id: legacyPhase, round_number: 1 };
const NATIVE_PHASE = {
  id: PHASE, season_id: LEAGUE, name: 'Native Phase', season_name: 'Example League',
  ruleset_name: 'Gen 9', season_format_type: 'singles', bracket_type: 'swiss',
};
const NATIVE_OWNER = { kind: 'phase', phase_id: PHASE, season_id: LEAGUE };
const LEGACY_OWNER = { kind: 'tournament', tournament_id: PHASE, season_id: LEAGUE };

function params(id = LEAGUE, phaseId = PHASE, mid = MATCH) {
  return { params: Promise.resolve({ id, phaseId, mid }) };
}

function elements(node: ReactNode): { type: unknown; props: Record<string, unknown> }[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown> & { children?: ReactNode; action?: ReactNode }>(node)) return [];
  return [node, ...elements(node.props.children), ...elements(node.props.action)];
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.mode.mockResolvedValue('phase');
  mock.legacyOwner.mockResolvedValue(LEGACY_OWNER);
  mock.nativeOwner.mockResolvedValue(NATIVE_OWNER);
  mock.legacyMatch.mockResolvedValue(LEGACY_MATCH);
  mock.nativeMatch.mockResolvedValue(NATIVE_MATCH);
  mock.phase.mockResolvedValue(NATIVE_PHASE);
  mock.phaseRounds.mockResolvedValue([
    { id: NATIVE_MATCH.round_id, phase_id: PHASE, name: 'Round 1', best_of: 3, round_number: 1, bye_player_ids: ['bye'] },
  ]);
  mock.phaseMatches.mockResolvedValue([NATIVE_MATCH]);
  mock.phaseParticipants.mockResolvedValue([{ id: 'player-1', name: 'Sample One' }]);
  mock.context.mockResolvedValue({ formatType: 'singles' });
  mock.standings.mockReturnValue([]);
  mock.gameStats.mockResolvedValue({});
  mock.analysis.mockResolvedValue(null);
  mock.streaks.mockResolvedValue(null);
  mock.access.mockResolvedValue(null);
  mock.proposals.mockResolvedValue([]);
  mock.snapshots.mockResolvedValue([]);
  mock.season.mockResolvedValue(null);
  mock.listEntries.mockResolvedValue([]);
  mock.replayViewed.mockResolvedValue(false);
});

describe('canonical league phase match', () => {
  it.each([params('bad'), params(LEAGUE, 'bad'), params(LEAGUE, PHASE, 'bad')])(
    'rejects a malformed URL before deciding which store to read', async input => {
      await expect(Page(input)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(mock.mode).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the mode loader reports maintenance', async () => {
    mock.mode.mockRejectedValue(new Error('Phase storage unavailable'));
    await expect(Page(params())).rejects.toThrow('Phase storage unavailable');
    expect(mock.legacyOwner).not.toHaveBeenCalled();
    expect(mock.nativeOwner).not.toHaveBeenCalled();
  });

  it.each([null, { ...NATIVE_OWNER, season_id: OTHER }, { ...NATIVE_OWNER, phase_id: OTHER }])(
    'rejects an unowned native address before reading the match or viewer', async owner => {
      mock.nativeOwner.mockResolvedValue(owner);
      await expect(Page(params())).rejects.toThrow('NEXT_NOT_FOUND');
      expect(mock.nativeOwner).toHaveBeenCalledWith({ phaseId: PHASE, matchId: MATCH });
      expect(mock.nativeMatch).not.toHaveBeenCalled();
      expect(mock.legacyOwner).not.toHaveBeenCalled();
      expect(mock.access).not.toHaveBeenCalled();
    },
  );

  it.each([null, { ...NATIVE_MATCH, phase_id: OTHER }, { ...NATIVE_MATCH, id: OTHER }])(
    'rejects a missing or mismatched native row without falling back', async match => {
      mock.nativeMatch.mockResolvedValue(match);
      await expect(Page(params())).rejects.toThrow('NEXT_NOT_FOUND');
      expect(mock.phase).not.toHaveBeenCalled();
      expect(mock.gameStats).not.toHaveBeenCalled();
      expect(mock.legacyMatch).not.toHaveBeenCalled();
    },
  );

  it('renders native games, round, standings and completed analysis with scoped data and no write identifiers', async () => {
    const analysis = { status: 'completed', analysis: { headline: 'Sample analysis' }, error: 'internal error' };
    mock.analysis.mockResolvedValue(analysis);
    mock.contentLocale.mockResolvedValue('de');
    const items = elements(await Page(params()));
    const card = items.find(el => el.type === MatchHighlightCard);
    expect(card?.props).toMatchObject({ tournamentName: NATIVE_PHASE.name, bestOf: 3, games: [GAME] });
    expect(card?.props.analysis).not.toHaveProperty('error');
    expect(items.some(el => el.props.href === PHASE_HREF)).toBe(true);
    expect(items.some(el => typeof el.props.href === 'string' && /\/(dashboard|tournaments)\//.test(el.props.href))).toBe(false);
    expect(items.find(el => el.type === MatchSchedulingPanel)?.props).toMatchObject({ matchId: undefined, canManage: false });
    expect(items.find(el => el.type === GameDetailCard)?.props).toMatchObject({ game: GAME, canEdit: false, editVersion: undefined });
    expect(items.find(el => el.type === MatchAnalysisCard)?.props).toMatchObject({ matchId: undefined, contentLocale: 'de' });
    expect(items.some(el => el.type === CreateSocialImageButton)).toBe(false);
    expect(mock.gameStats).toHaveBeenCalledWith(MATCH);
    expect(mock.analysis).toHaveBeenCalledWith(PHASE, MATCH);
    expect(mock.standings).toHaveBeenCalledWith(
      expect.objectContaining({ formatType: 'singles' }), ['player-1'], { 'player-1': 'Sample One' },
      [expect.objectContaining({ match_id: MATCH, round_number: 1 })], {}, { byes: [{ player_id: 'bye', round_number: 1 }] },
    );
    expect(mock.privateMatch).not.toHaveBeenCalled();
    expect(mock.proposals).not.toHaveBeenCalled();
    expect(mock.legacyMatch).not.toHaveBeenCalled();
  });

  it('uses live site-admin access for note reads, not for legacy write controls', async () => {
    mock.access.mockResolvedValue({ player: { playerId: 'admin', status: 'active' }, isSiteAdmin: true });
    mock.privateMatch.mockResolvedValue({ ...NATIVE_MATCH, notes: 'Admin dispute log' });
    const items = elements(await Page(params()));
    expect(mock.privateMatch).toHaveBeenCalledWith(MATCH);
    expect(items.some(el => el.props.children === 'Admin dispute log')).toBe(true);
    expect(items.some(el => el.type === CreateSocialImageButton)).toBe(false);
    expect(items.find(el => el.type === GameDetailCard)?.props.canEdit).toBe(false);
  });

  it.each(['active', 'suspended'])('gates private proposal reads by the live participant status (%s)', async status => {
    const proposal = { id: 'proposal-1', message: 'Participant-only scheduling message' };
    mock.access.mockResolvedValue({ player: { playerId: NATIVE_MATCH.player_1_id, status }, isSiteAdmin: false });
    mock.proposals.mockResolvedValue([proposal]);
    mock.nativeMatch.mockResolvedValue({ ...NATIVE_MATCH, status: 'scheduled' });
    const items = elements(await Page(params()));
    const scheduling = items.find(el => el.type === MatchSchedulingPanel);
    expect(scheduling?.props).toMatchObject({ matchId: undefined, canManage: false, initialProposals: status === 'active' ? [proposal] : [] });
    if (status === 'active') expect(mock.proposals).toHaveBeenCalledWith(MATCH, NATIVE_MATCH.player_1_id);
    else expect(mock.proposals).not.toHaveBeenCalled();
    expect(mock.privateMatch).not.toHaveBeenCalled();
    expect(items.some(el => typeof el.props.href === 'string' && el.props.href.startsWith('/dashboard/'))).toBe(false);
  });

  it('reads native EPB snapshots and viewed state but supplies no legacy write endpoint', async () => {
    mock.phase.mockResolvedValue({ ...NATIVE_PHASE, season_format_type: 'evolution_point_buy' });
    mock.access.mockResolvedValue({ player: { playerId: 'viewer', status: 'active' } });
    mock.snapshots.mockResolvedValue([{ id: 'snapshot', player_id: NATIVE_MATCH.player_1_id, evolution_triggered: true }]);
    mock.replayViewed.mockResolvedValue(true);
    const items = elements(await Page(params()));
    expect(mock.snapshots).toHaveBeenCalledWith(MATCH);
    expect(mock.replayViewed).toHaveBeenCalledWith('viewer', MATCH);
    expect(items.find(el => el.type === MatchEvolutionReplay)?.props).toMatchObject({
      viewedEndpoint: undefined, initialViewed: true, isAuthenticated: true,
    });
  });

  it('selects the legacy match adapter and passes the canonical ancestor', async () => {
    mock.mode.mockResolvedValue('legacy');
    await Page(params());
    expect(mock.legacyOwner).toHaveBeenCalledWith(LEAGUE, PHASE, 'legacy');
    expect(mock.renderLegacy).toHaveBeenCalledWith(PHASE, MATCH, {
      seasonId: LEAGUE, href: PHASE_HREF, match: LEGACY_MATCH,
    });
    expect(mock.nativeOwner).not.toHaveBeenCalled();
    expect(mock.nativeMatch).not.toHaveBeenCalled();
  });

  it('does not resolve a legacy match until the phase belongs to its league', async () => {
    mock.mode.mockResolvedValue('legacy');
    mock.legacyOwner.mockResolvedValue({ ...LEGACY_OWNER, season_id: OTHER });
    await expect(Page(params())).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mock.legacyMatch).not.toHaveBeenCalled();
    expect(mock.renderLegacy).not.toHaveBeenCalled();
  });

  it('rejects a legacy cross-phase match before calling the adapter', async () => {
    mock.mode.mockResolvedValue('legacy');
    mock.legacyMatch.mockResolvedValue({ ...LEGACY_MATCH, tournament_id: OTHER });
    await expect(Page(params())).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mock.renderLegacy).not.toHaveBeenCalled();
    expect(mock.nativeOwner).not.toHaveBeenCalled();
  });

  it('emits match metadata with the canonical URL only for a scoped owner', async () => {
    await expect(generateMetadata(params())).resolves.toMatchObject({ alternates: { canonical: MATCH_HREF } });
    mock.nativeOwner.mockResolvedValue(null);
    await expect(generateMetadata(params())).resolves.toEqual({});
  });
});
