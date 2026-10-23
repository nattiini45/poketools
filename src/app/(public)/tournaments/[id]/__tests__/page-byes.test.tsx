/**
 * The public tournament page scores a Swiss tournament's stored byes in the
 * standings table it renders. Only the standings call is asserted;
 * every read and every child component is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reads, computeStandingsForFormat } = vi.hoisted(() => ({
  reads: {
    tournament: vi.fn(),
    tournamentRounds: vi.fn(),
    tournamentMatches: vi.fn(),
    tournamentParticipants: vi.fn(),
    tournamentMatchRecords: vi.fn(),
    tournamentBattleStats: vi.fn(),
    seasonGymTypes: vi.fn(),
    tournamentReports: vi.fn(),
    aggregatesSummary: vi.fn(),
    totalGames: vi.fn(),
    seasonRow: vi.fn(),
    seasonEvolutionPoints: vi.fn(),
  },
  computeStandingsForFormat: vi.fn(() => []),
}));

vi.mock('next/link', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/cache/public-reads', () => ({ publicReads: reads }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn(async () => null) }));
vi.mock('@/lib/tournament/standings', () => ({ computeStandingsForFormat }));
vi.mock('@/lib/worlds/registry', () => ({
  resolveViewerWorld: vi.fn(() => null),
  getWorldByRouteThemeId: vi.fn(() => null),
  getDefaultWorld: vi.fn(() => null),
  WORLD_OVERRIDE_URL_PARAM: 'world',
}));
vi.mock('@/components/world/WorldShell', () => ({ default: () => null }));
vi.mock('@/components/world/route/WorldOverrideRedirect', () => ({ default: () => null }));
vi.mock('@/components/ui/PageContainer', () => ({ default: () => null }));
vi.mock('@/components/ui/Badge', () => ({ default: () => null }));
vi.mock('@/components/ui/buttonStyles', () => ({ getButtonClasses: () => '' }));
vi.mock('@/components/ruleset/RulesetDetail', () => ({ default: () => null }));
vi.mock('@/components/bracket/ElimBracketView', () => ({ default: () => null }));
vi.mock('@/components/bracket/SwissStandings', () => ({ default: () => null }));
vi.mock('@/components/tournament/TournamentTabsUnified', () => ({ default: () => null }));
vi.mock('@/i18n/server', () => ({ getT: vi.fn(async () => (key: string) => key) }));
vi.mock('@/i18n/content/enum-label', () => ({ enumLabel: () => '' }));

import TournamentPage from '../page';

const PARTICIPANTS = [
  { id: 'p1', name: 'Alice', avatar_url: null },
  { id: 'p2', name: 'Bob', avatar_url: null },
  { id: 'p3', name: 'Cleo', avatar_url: null },
];

function round(round_number: number, bye_player_ids: string[]) {
  return { id: `r${round_number}`, round_number, name: `Round ${round_number}`, status: 'completed', bye_player_ids };
}

async function renderPage(bracketType: string, rounds: ReturnType<typeof round>[]) {
  reads.tournament.mockResolvedValue({
    id: 't-1',
    name: 'Cup',
    bracket_type: bracketType,
    season_id: null,
    is_doubles: false,
    best_of_default: 3,
    ruleset_id: null,
    ruleset_name: 'Ruleset',
    participant_count: 3,
    description: null,
  });
  reads.tournamentRounds.mockResolvedValue(rounds);
  await TournamentPage({
    params: Promise.resolve({ id: 't-1' }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  reads.tournamentMatches.mockResolvedValue([]);
  reads.tournamentParticipants.mockResolvedValue(PARTICIPANTS);
  reads.tournamentMatchRecords.mockResolvedValue([]);
  reads.tournamentBattleStats.mockResolvedValue([]);
  reads.seasonGymTypes.mockResolvedValue({});
  reads.tournamentReports.mockResolvedValue([]);
  reads.aggregatesSummary.mockResolvedValue([]);
  reads.totalGames.mockResolvedValue(0);
  reads.seasonRow.mockResolvedValue(null);
});

describe('TournamentPage standings and Swiss byes', () => {
  it('passes the stored byes of a Swiss tournament to the standings', async () => {
    await renderPage('swiss', [round(1, ['p3']), round(2, ['p2'])]);

    expect(computeStandingsForFormat).toHaveBeenCalledTimes(1);
    // (format, ids, names, records, avatars, options, gymTypes, extras)
    const options = (computeStandingsForFormat.mock.calls[0] as unknown[])[5];
    expect(options).toEqual({
      byes: [
        { player_id: 'p3', round_number: 1 },
        { player_id: 'p2', round_number: 2 },
      ],
    });
  });

  it('passes no byes for a legacy Swiss tournament (rounds hold none)', async () => {
    await renderPage('swiss', [round(1, []), round(2, [])]);

    expect((computeStandingsForFormat.mock.calls[0] as unknown[])[5]).toEqual({ byes: [] });
  });

  it('passes no byes for an elimination tournament, whatever its rounds hold', async () => {
    await renderPage('single_elim', [round(1, ['p3'])]);

    expect((computeStandingsForFormat.mock.calls[0] as unknown[])[5]).toEqual({ byes: [] });
  });
});
