import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhaseStorageMode } from '@/lib/supabase/queries/phase-storage';

const reads = vi.hoisted(() => ({
  mode: vi.fn<() => Promise<PhaseStorageMode>>(),
  seasonList: vi.fn(),
  nativeSeasonList: vi.fn(),
  tournamentList: vi.fn(),
  standingsPreview: vi.fn(),
  seasonStandingsPreview: vi.fn(),
  hiddenPlayerIds: vi.fn(async () => []),
}));

vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: reads.mode }));
vi.mock('@/lib/cache/public-reads', () => ({ publicReads: reads }));
vi.mock('@/lib/cache/phase-public-reads', () => ({ phasePublicReads: reads }));
vi.mock('@/lib/auth/helpers', () => ({ getSessionPlayer: async () => null }));
vi.mock('@/components/agent/AgentChatWidget', () => ({ default: () => null }));
vi.mock('@/components/home/HeroBall', () => ({ default: () => null }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import Home from '../page';
import LeaguesPage from '../leagues/page';

const league = {
  id: 'league-fixture', name: 'Fixture League', status: 'active', is_test_season: false,
  format_type: 'singles', participant_count: 4, ruleset_name: 'Fixture Rules',
};
const cup = {
  id: 'standalone-fixture', name: 'Fixture Open', status: 'active', bracket_type: 'swiss',
  is_doubles: false, participant_count: 3,
};

beforeEach(() => {
  vi.resetAllMocks();
  reads.seasonList.mockResolvedValue([{ ...league, tournament_count: 1 }]);
  reads.nativeSeasonList.mockResolvedValue([{ ...league, tournament_count: 3 }]);
  reads.tournamentList.mockResolvedValue([cup]);
  reads.standingsPreview.mockResolvedValue([{ rank: 1, player_name: 'Legacy Trainer', wins: 1, losses: 0 }]);
  reads.seasonStandingsPreview.mockResolvedValue([{ rank: 1, player_name: 'Native Trainer', wins: 2, losses: 0 }]);
});

describe('public league discovery', () => {
  it.each([
    ['legacy', false], ['frozen_legacy', false], ['phase', true], ['frozen_phase', true],
  ] as const)('uses the active league owner in %s mode', async (mode, native) => {
    reads.mode.mockResolvedValue(mode);

    const home = renderToStaticMarkup(await Home());
    expect(home).toContain(native ? 'Native Trainer' : 'Legacy Trainer');
    expect(home).not.toContain(native ? 'Legacy Trainer' : 'Native Trainer');
    expect(home).toContain('href="/tournaments/standalone-fixture"');
    if (native) {
      expect(reads.seasonStandingsPreview).toHaveBeenCalledExactlyOnceWith(league.id, 3);
      expect(reads.standingsPreview).not.toHaveBeenCalled();
    } else {
      expect(reads.standingsPreview).toHaveBeenCalledExactlyOnceWith('league', league.id, 3);
      expect(reads.seasonStandingsPreview).not.toHaveBeenCalled();
    }

    const list = renderToStaticMarkup(await LeaguesPage());
    expect(list).toContain('href="/leagues/league-fixture"');
    expect(list).toContain(native ? '3 stages' : '1 stage');
    expect(native ? reads.seasonList : reads.nativeSeasonList).not.toHaveBeenCalled();
    expect(reads.mode).toHaveBeenCalledTimes(2);
  });

  it('still features the standalone tournament if only test leagues are active', async () => {
    reads.mode.mockResolvedValue('phase');
    reads.nativeSeasonList.mockResolvedValue([{ ...league, is_test_season: true }]);

    const home = renderToStaticMarkup(await Home());
    expect(home).toContain('id="home-featured-heading"');
    expect(home).toContain(cup.name);
    expect(reads.standingsPreview).toHaveBeenCalledExactlyOnceWith('tournament', cup.id, 3);
    expect(reads.seasonStandingsPreview).not.toHaveBeenCalled();
  });
});
