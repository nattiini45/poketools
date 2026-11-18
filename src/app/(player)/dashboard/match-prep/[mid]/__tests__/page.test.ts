/**
 * The dashboard match-prep page: every read fails loudly (AGENTS.md rule 5).
 * A failed prep-team, ruleset or scouting read reaches the error
 * boundary instead of rendering an empty prep form or "no ruleset". The page
 * runs as a plain async function (vitest 'node' env) and its element tree is
 * walked without rendering the child components.
 */
import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn(),
  isSuperadminNow: vi.fn(),
  getMatchById: vi.fn(),
  getTournamentById: vi.fn(),
  getRulesetById: vi.fn(),
  getMatchPrepTeam: vi.fn(),
  getMatchPrepAnalysis: vi.fn(),
  resolveIdOnlyMatchRoute: vi.fn(),
  getPhaseMatchById: vi.fn(),
  getPhaseById: vi.fn(),
  isPlayerPhaseParticipant: vi.fn(),
  getPlayerPhaseMatchPrep: vi.fn(),
  getPhaseMatchPrepAnalysis: vi.fn(),
  resolveContentLocale: vi.fn(),
}));

vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
  };
});
vi.mock('@/i18n/content-locale', () => ({ resolveContentLocale: mocks.resolveContentLocale }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }));
vi.mock('@/components/shared/AuthGuard', () => ({ default: () => null }));
vi.mock('@/components/match/MatchPrepClient', () => ({ default: () => null }));
vi.mock('@/components/match/MatchStatusBadge', () => ({ default: () => null }));
vi.mock('@/components/ui/PageContainer', () => ({ default: () => null }));
vi.mock('@/lib/auth/helpers', () => ({
  getLiveAccess: mocks.getLiveAccess,
  isSuperadminNow: mocks.isSuperadminNow,
}));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: mocks.getMatchById }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: mocks.getTournamentById }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: mocks.getRulesetById,
}));
vi.mock('@/lib/supabase/queries/match-prep-teams', () => ({ getMatchPrepTeam: mocks.getMatchPrepTeam }));
vi.mock('@/lib/supabase/queries/match-prep-analyses', () => ({
  getMatchPrepAnalysis: mocks.getMatchPrepAnalysis,
}));
vi.mock('@/lib/league-phase/match-route-owner', () => ({ resolveIdOnlyMatchRoute: mocks.resolveIdOnlyMatchRoute }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: mocks.getPhaseMatchById }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({
  getPhaseById: mocks.getPhaseById,
  isPlayerPhaseParticipant: mocks.isPlayerPhaseParticipant,
}));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPlayerPhaseMatchPrep: mocks.getPlayerPhaseMatchPrep }));
vi.mock('@/lib/supabase/queries/phase-ai-artifacts', () => ({ getPhaseMatchPrepAnalysis: mocks.getPhaseMatchPrepAnalysis }));

import MatchPrepPage from '../page';
import MatchPrepClient from '@/components/match/MatchPrepClient';

// ─── Helpers ────────────────────────────────────────────────────────

const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const PLAYER_ID = '44444444-4444-4444-8444-444444444444';
const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const SEASON_ID = '55555555-5555-4555-8555-555555555555';
const PHASE_ID = '66666666-6666-4666-8666-666666666666';
const NATIVE_MATCH = {
  id: MATCH_ID, phase_id: PHASE_ID, status: 'scheduled',
  player_1_id: PLAYER_ID, player_2_id: 'opponent',
  player_1_name: 'Ash', player_2_name: 'Gary',
};

function nativePage() {
  mocks.resolveIdOnlyMatchRoute.mockResolvedValue({ kind: 'phase', phase_id: PHASE_ID, season_id: SEASON_ID });
  mocks.getPhaseMatchById.mockResolvedValue(NATIVE_MATCH);
  mocks.getPhaseById.mockResolvedValue({ id: PHASE_ID, season_id: SEASON_ID, ruleset_id: 'ruleset-1' });
  mocks.isPlayerPhaseParticipant.mockResolvedValue(true);
  mocks.getPlayerPhaseMatchPrep.mockResolvedValue({ pokemon: [{ species: 'Pikachu' }] });
  mocks.getPhaseMatchPrepAnalysis.mockResolvedValue(null);
}

function params(mid: string) {
  return { params: Promise.resolve({ mid }) };
}

/** The props of the first element of `type` anywhere in the tree (props.children only). */
function findProps(node: ReactNode, type: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findProps(child, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === type) return node.props as Record<string, unknown>;
  return findProps(node.props.children, type);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveIdOnlyMatchRoute.mockResolvedValue({ kind: 'legacy' });
  mocks.getLiveAccess.mockResolvedValue({ player: { playerId: PLAYER_ID, name: 'Ash', isAdmin: false } });
  mocks.isSuperadminNow.mockResolvedValue(false);
  mocks.getMatchById.mockResolvedValue({
    id: MATCH_ID,
    tournament_id: TOURNAMENT_ID,
    status: 'scheduled',
    player_1_id: PLAYER_ID,
    player_2_id: 'opponent',
    player_1_name: 'Ash',
    player_2_name: 'Gary',
  });
  mocks.getTournamentById.mockResolvedValue({
    id: TOURNAMENT_ID,
    season_id: SEASON_ID,
    ruleset_id: 'ruleset-1',
    bracket_type: 'round_robin',
  });
  // The phase's own pin: an immutable ruleset version.
  mocks.getRulesetById.mockResolvedValue({ id: 'ruleset-1', name: 'Gen 9 OU', base_format: 'gen9ou', gen: 9 });
  mocks.getMatchPrepTeam.mockResolvedValue({ pokemon: [{ species: 'Pikachu' }] });
  mocks.getMatchPrepAnalysis.mockResolvedValue(null);
  mocks.resolveContentLocale.mockResolvedValue('en');
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('MatchPrepPage', () => {
  it('renders the prep client with the effective ruleset and the stored team', async () => {
    const tree = await MatchPrepPage(params(MATCH_ID));
    const props = findProps(tree, MatchPrepClient);

    expect(props).toMatchObject({
      matchId: MATCH_ID,
      // The editor checks the team by the round of this match, and the validation panel reads the season's pools.
      tournamentId: TOURNAMENT_ID,
      seasonId: SEASON_ID,
      rulesetId: 'ruleset-1',
      rulesetName: 'Gen 9 OU',
      // The generation is the ruleset's own, not parsed from its format key.
      baseFormat: 'gen9ou',
      gen: 9,
      opponentName: 'Gary',
      hasExistingPrepTeam: true,
    });
    expect(mocks.getRulesetById).toHaveBeenCalledWith('ruleset-1');
  });

  it('404s a malformed match id without querying the database', async () => {
    await expect(MatchPrepPage(params('abc'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getMatchById).not.toHaveBeenCalled();
  });

  it('binds the native match, its pinned ruleset and only the caller’s prep and scouting report', async () => {
    nativePage();
    const tree = await MatchPrepPage(params(MATCH_ID));
    expect(findProps(tree, MatchPrepClient)).toMatchObject({
      phaseId: PHASE_ID, tournamentId: undefined, seasonId: SEASON_ID, matchId: MATCH_ID,
      rulesetId: 'ruleset-1', initialPokemon: [{ species: 'Pikachu' }], showScouting: true, locked: false,
    });
    expect(mocks.getPlayerPhaseMatchPrep).toHaveBeenCalledExactlyOnceWith(MATCH_ID, PLAYER_ID);
    expect(mocks.getPhaseMatchPrepAnalysis).toHaveBeenCalledExactlyOnceWith(PHASE_ID, MATCH_ID, PLAYER_ID);
    expect(mocks.getMatchById).not.toHaveBeenCalled();
    expect(mocks.getTournamentById).not.toHaveBeenCalled();
    expect(mocks.getMatchPrepTeam).not.toHaveBeenCalled();
  });

  it('rejects a changed owner or lapsed enrollment before loading private data', async () => {
    nativePage();
    mocks.getPhaseMatchById.mockResolvedValueOnce({ ...NATIVE_MATCH, phase_id: 'wrong' });
    await expect(MatchPrepPage(params(MATCH_ID))).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.isPlayerPhaseParticipant.mockResolvedValueOnce(false);
    await expect(MatchPrepPage(params(MATCH_ID))).rejects.toThrow('NEXT_REDIRECT /dashboard');
    expect(mocks.getPlayerPhaseMatchPrep).not.toHaveBeenCalled();
    expect(mocks.getPhaseMatchPrepAnalysis).not.toHaveBeenCalled();
  });

  it('locks a completed native prep and does not offer scouting', async () => {
    nativePage();
    mocks.getPhaseMatchById.mockResolvedValueOnce({ ...NATIVE_MATCH, status: 'completed' });
    const tree = await MatchPrepPage(params(MATCH_ID));
    expect(findProps(tree, MatchPrepClient)).toMatchObject({ showScouting: false, locked: true });
    expect(mocks.getPhaseMatchPrepAnalysis).not.toHaveBeenCalled();
  });

  it('does not load either side’s prep or scouting for a non-playing superadmin', async () => {
    nativePage();
    mocks.getLiveAccess.mockResolvedValueOnce({ player: { playerId: 'outsider', isAdmin: true } });
    mocks.isSuperadminNow.mockResolvedValueOnce(true);
    const tree = await MatchPrepPage(params(MATCH_ID));
    expect(findProps(tree, MatchPrepClient)).toMatchObject({
      showScouting: false, initialPokemon: undefined, locked: true,
    });
    expect(mocks.getPlayerPhaseMatchPrep).not.toHaveBeenCalled();
    expect(mocks.getPhaseMatchPrepAnalysis).not.toHaveBeenCalled();
  });

  it.each([
    ['prep-team', () => mocks.getMatchPrepTeam.mockRejectedValueOnce(new Error('prep-team read failed'))],
    ['ruleset', () => mocks.getRulesetById.mockRejectedValueOnce(new Error('ruleset read failed'))],
    ['scouting', () => mocks.getMatchPrepAnalysis.mockRejectedValueOnce(new Error('scouting read failed'))],
  ])('surfaces a failed %s read to the error boundary', async (label, arrange) => {
    arrange();
    await expect(MatchPrepPage(params(MATCH_ID))).rejects.toThrow(`${label} read failed`);
  });
});
