import { describe, expect, it } from 'vitest';
import type { PlayerScopeUsageRow } from '@/lib/supabase/queries/aggregates';
import { buildTeamsUsed, teamsUsedScopeIds, type TeamsUsedLeague, type TeamsUsedTournament } from '../teams-used';

const row = (
  scope_type: PlayerScopeUsageRow['scope_type'],
  scope_id: string,
  pokemon_name: string,
  total_brought: number,
): PlayerScopeUsageRow => ({ scope_type, scope_id, pokemon_name, total_brought });

const leagues: TeamsUsedLeague[] = [
  { id: 'old-league', name: 'Example Gym Leader League', status: 'completed', created_at: '2026-01-01T00:00:00Z' },
  { id: 'new-league', name: 'Type Triangle League', status: 'completed', created_at: '2026-06-01T00:00:00Z' },
];

const tournaments: TeamsUsedTournament[] = [
  { id: 'stage-1', name: 'Stage 1', status: 'completed', season_id: 'new-league', created_at: '2026-06-02T00:00:00Z' },
  { id: 'cup', name: 'Winter Cup', status: 'active', season_id: null, created_at: '2026-03-01T00:00:00Z' },
];

describe('buildTeamsUsed', () => {
  it('makes one team per league and standalone tournament, newest first', () => {
    const teams = buildTeamsUsed(
      [
        row('league', 'old-league', 'Garchomp', 4),
        row('league', 'new-league', 'Great Tusk', 6),
        row('tournament', 'cup', 'Gholdengo', 2),
      ],
      leagues,
      tournaments,
    );
    expect(teams.map((t) => [t.kind, t.id, t.name])).toEqual([
      ['league', 'new-league', 'Type Triangle League'],
      ['tournament', 'cup', 'Winter Cup'],
      ['league', 'old-league', 'Example Gym Leader League'],
    ]);
  });

  it('drops league-stage tournament scopes, which the league scope already counts', () => {
    const teams = buildTeamsUsed(
      [row('league', 'new-league', 'Great Tusk', 6), row('tournament', 'stage-1', 'Great Tusk', 6)],
      leagues,
      tournaments,
    );
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ kind: 'league', id: 'new-league', pokemon: [{ name: 'Great Tusk', brought: 6 }] });
  });

  it('sorts Pokémon by times brought, then by name', () => {
    const [team] = buildTeamsUsed(
      [
        row('league', 'new-league', 'Iron Valiant', 2),
        row('league', 'new-league', 'Amoonguss', 2),
        row('league', 'new-league', 'Great Tusk', 7),
      ],
      leagues,
      tournaments,
    );
    expect(team.pokemon).toEqual([
      { name: 'Great Tusk', brought: 7 },
      { name: 'Amoonguss', brought: 2 },
      { name: 'Iron Valiant', brought: 2 },
    ]);
  });

  it('drops scopes whose league or tournament is unknown (deleted)', () => {
    const teams = buildTeamsUsed(
      [row('league', 'gone', 'Mew', 1), row('tournament', 'gone-too', 'Mew', 1)],
      leagues,
      tournaments,
    );
    expect(teams).toEqual([]);
  });
});

describe('teamsUsedScopeIds', () => {
  it('lists each league and tournament id once', () => {
    expect(
      teamsUsedScopeIds([
        row('league', 'a', 'Mew', 1),
        row('league', 'a', 'Mewtwo', 1),
        row('tournament', 'b', 'Mew', 1),
      ]),
    ).toEqual({ leagueIds: ['a'], tournamentIds: ['b'] });
  });
});
