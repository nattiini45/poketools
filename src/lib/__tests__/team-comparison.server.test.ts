import { beforeEach, describe, expect, it, vi } from 'vitest';

const queries = vi.hoisted(() => ({
  getSharedComparisonLeagues: vi.fn(), getComparisonTrackers: vi.fn(), getComparisonPicks: vi.fn(), getComparisonRegisteredRoster: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/team-comparison', () => queries);
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock('@/lib/revalidation', () => ({ publicTags: { seasons: 'seasons', season: (id: string) => `season:${id}` } }));
import { loadTeamComparison } from '../team-comparison.server';

const league = { id: 'league', name: 'Example Cup', format_type: 'evolution_point_buy', start_date: null, created_at: '2026-11-01' };

beforeEach(() => {
  vi.clearAllMocks();
  queries.getSharedComparisonLeagues.mockResolvedValue([league]);
  queries.getComparisonTrackers.mockImplementation((_season: string, player: string) => Promise.resolve(player === 'mine' ? ['Charmeleon'] : ['Wartortle']));
});

describe('comparison roster loading', () => {
  it('reads two current EPB rosters after the draft without reading picks or teams', async () => {
    const data = await loadTeamComparison('mine', 'theirs');
    expect(data.theirHits[0]).toMatchObject({ attacker: 'Wartortle', defender: 'Charmeleon' });
    expect(queries.getComparisonTrackers).toHaveBeenCalledTimes(2);
    expect(queries.getComparisonPicks).not.toHaveBeenCalled();
    expect(queries.getComparisonRegisteredRoster).not.toHaveBeenCalled();
  });

  it('does not read rosters for a league the pair does not share', async () => {
    const data = await loadTeamComparison('mine', 'theirs', 'unrelated');
    expect(data.leagueId).toBeNull();
    expect(queries.getComparisonTrackers).not.toHaveBeenCalled();
  });

  it('uses draft picks for a non-EPB drafted league', async () => {
    queries.getSharedComparisonLeagues.mockResolvedValue([{ ...league, format_type: 'standard' }]);
    queries.getComparisonPicks.mockResolvedValue(['Pikachu']);
    const data = await loadTeamComparison('mine', 'theirs');
    expect(data.mine.pokemon[0].species).toBe('Pikachu');
    expect(queries.getComparisonRegisteredRoster).not.toHaveBeenCalled();
    expect(queries.getComparisonPicks).toHaveBeenCalledTimes(2);
  });

  it('does not generate coverage or species for a hidden registered roster', async () => {
    queries.getSharedComparisonLeagues.mockResolvedValue([{ ...league, format_type: 'standard' }]);
    queries.getComparisonPicks.mockResolvedValue([]);
    queries.getComparisonRegisteredRoster.mockImplementation((_season: string, player: string) => Promise.resolve(
      player === 'mine' ? { hidden: false, species: ['Charmeleon'] } : { hidden: true, species: [] }
    ));
    const data = await loadTeamComparison('mine', 'theirs');
    expect(data.theirs).toEqual({ hidden: true, pokemon: [] });
    expect(data.myHits).toEqual([]);
    expect(data.theirHits).toEqual([]);
    expect(queries.getComparisonRegisteredRoster).toHaveBeenCalledWith('league', 'theirs', 'mine');
  });
});
