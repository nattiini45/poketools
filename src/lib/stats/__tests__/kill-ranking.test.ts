import { describe, it, expect } from 'vitest';
import { buildKillRanking } from '../kill-ranking';
import type { TournamentBattleStat } from '@/lib/supabase/queries/games';

function stat(
  pokemon: string,
  kos: number,
  koed: boolean,
  brought: boolean,
): TournamentBattleStat {
  return {
    pokemon_name: pokemon,
    kos_dealt: kos,
    was_koed: koed,
    was_brought: brought,
  } as TournamentBattleStat;
}

describe('buildKillRanking', () => {
  it('aggregates KOs and participation per Pokémon', () => {
    const rows = buildKillRanking([
      stat('Garchomp', 2, false, true),
      stat('Garchomp', 1, true, true),
      stat('Landorus', 0, true, false),
    ]);

    expect(rows).toHaveLength(2);
    const garchomp = rows.find((r) => r.pokemon_name === 'Garchomp');
    expect(garchomp).toMatchObject({
      kos_dealt: 3,
      times_koed: 1,
      kill_differential: 2,
      participations: 2,
      times_in_team: 2,
    });
    expect(garchomp!.efficiency).toBeCloseTo(1.5);

    const landorus = rows.find((r) => r.pokemon_name === 'Landorus');
    expect(landorus).toMatchObject({
      kos_dealt: 0,
      times_koed: 1,
      participations: 0,
      times_in_team: 1,
    });
  });

  it('returns empty array for no stats', () => {
    expect(buildKillRanking([])).toEqual([]);
  });
});
