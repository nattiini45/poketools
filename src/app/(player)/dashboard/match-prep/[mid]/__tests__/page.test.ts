/**
 * The dashboard match-prep page: every read fails loudly (AGENTS.md rule 5).
 * A failed prep-team, season, ruleset or scouting read reaches the error
 * boundary instead of rendering an empty prep form or "no ruleset". The page
 * runs as a plain async function (vitest 'node' env) and its element tree is
 * walked without rendering the child components.
 */
import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  isSuperadmin: vi.fn(),
  getMatchById: vi.fn(),
  getTournamentById: vi.fn(),
  resolveEffectiveRuleset: vi.fn(),
  getSeasonById: vi.fn(),
  getMatchPrepTeam: vi.fn(),
  getMatchPrepAnalysis: vi.fn(),
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
vi.mock('@/components/shared/AuthGuard', () => ({ default: () => null }));
vi.mock('@/components/match/MatchPrepClient', () => ({ default: () => null }));
vi.mock('@/components/match/MatchStatusBadge', () => ({ default: () => null }));
vi.mock('@/components/ui/PageContainer', () => ({ default: () => null }));
vi.mock('@/lib/auth/helpers', () => ({
  getSession: mocks.getSession,
  isSuperadmin: mocks.isSuperadmin,
}));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: mocks.getMatchById }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: mocks.getTournamentById }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({
  resolveEffectiveRuleset: mocks.resolveEffectiveRuleset,
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: mocks.getSeasonById }));
vi.mock('@/lib/supabase/queries/match-prep-teams', () => ({ getMatchPrepTeam: mocks.getMatchPrepTeam }));
vi.mock('@/lib/supabase/queries/match-prep-analyses', () => ({
  getMatchPrepAnalysis: mocks.getMatchPrepAnalysis,
}));

import MatchPrepPage from '../page';
import MatchPrepClient from '@/components/match/MatchPrepClient';

// ─── Helpers ────────────────────────────────────────────────────────

const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const PLAYER_ID = '44444444-4444-4444-8444-444444444444';
const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const SEASON_ID = '55555555-5555-4555-8555-555555555555';

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
  mocks.getSession.mockResolvedValue({
    player: { playerId: PLAYER_ID, name: 'Ash', isAdmin: false },
  });
  mocks.isSuperadmin.mockReturnValue(false);
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
  mocks.getSeasonById.mockResolvedValue({
    id: SEASON_ID,
    name: 'Spring',
    ruleset_id: 'ruleset-1',
    format_type: 'standard',
  });
  mocks.resolveEffectiveRuleset.mockResolvedValue({
    ruleset: { id: 'ruleset-1', name: 'Gen 9 OU', base_format: 'gen9ou' },
    rulesetId: 'ruleset-1',
    source: 'tournament',
    fellBack: false,
  });
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
      rulesetId: 'ruleset-1',
      rulesetName: 'Gen 9 OU',
      opponentName: 'Gary',
      hasExistingPrepTeam: true,
    });
    expect(mocks.resolveEffectiveRuleset).toHaveBeenCalledWith(
      expect.objectContaining({
        season: { id: SEASON_ID, name: 'Spring', rulesetId: 'ruleset-1', formatType: 'standard' },
      }),
    );
  });

  it('404s a malformed match id without querying the database', async () => {
    await expect(MatchPrepPage(params('abc'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getMatchById).not.toHaveBeenCalled();
  });

  it.each([
    ['prep-team', () => mocks.getMatchPrepTeam.mockRejectedValueOnce(new Error('prep-team read failed'))],
    ['season', () => mocks.getSeasonById.mockRejectedValueOnce(new Error('season read failed'))],
    ['ruleset', () => mocks.resolveEffectiveRuleset.mockRejectedValueOnce(new Error('ruleset read failed'))],
    ['scouting', () => mocks.getMatchPrepAnalysis.mockRejectedValueOnce(new Error('scouting read failed'))],
  ])('surfaces a failed %s read to the error boundary', async (label, arrange) => {
    arrange();
    await expect(MatchPrepPage(params(MATCH_ID))).rejects.toThrow(`${label} read failed`);
  });
});
