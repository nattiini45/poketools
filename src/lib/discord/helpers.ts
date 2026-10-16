import type { MatchWithPlayers } from '@/types/match';
import type { BattleStat } from '@/types/game';
import type { GamePokemonStats } from '@/types/discord';

/**
 * Compute Pokémon survivor score from per-game stats.
 * Derives survivors from KO counts: the loser lost all their mons,
 * so loser's KO'd count = team size. Winner's survivors =
 * loser's KO'd − winner's KO'd.
 */
export function computePokemonScoreFromGameStats(
  gameStats: GamePokemonStats[],
  player1Name: string,
  player2Name: string,
): { p1: number; p2: number } {
  let p1 = 0;
  let p2 = 0;

  for (const game of gameStats) {
    let p1Koed = 0;
    let p2Koed = 0;

    for (const player of game.players) {
      const koed = player.pokemon.filter((p) => p.was_koed).length;
      if (player.player_name === player1Name) p1Koed = koed;
      else if (player.player_name === player2Name) p2Koed = koed;
    }

    if (p1Koed > p2Koed) {
      p2 += p1Koed - p2Koed;
    } else if (p2Koed > p1Koed) {
      p1 += p2Koed - p1Koed;
    }
  }

  return { p1, p2 };
}

/**
 * Build the per-game Pokémon KO stats array from a match and its battle stats.
 *
 * @param match     - The match with player names and game list
 * @param statsByGame - Battle stats grouped by game ID (from getBattleStatsByMatch)
 */
export function buildGamePokemonStats(
  match: MatchWithPlayers,
  statsByGame: Record<string, BattleStat[]>,
): GamePokemonStats[] {
  return match.games
    .sort((a, b) => a.game_number - b.game_number)
    .map((game) => {
      const stats = statsByGame[game.id] ?? [];
      const p1Stats = stats.filter((s) => s.player_id === match.player_1_id);
      const p2Stats = stats.filter((s) => s.player_id === match.player_2_id);

      return {
        game_number: game.game_number,
        winner_id: game.winner_id,
        players: [
          {
            player_id: match.player_1_id,
            player_name: match.player_1_name,
            pokemon: p1Stats.map((s) => ({
              pokemon_name: s.pokemon_name,
              kos_dealt: s.kos_dealt,
              was_koed: s.was_koed,
            })),
          },
          {
            player_id: match.player_2_id,
            player_name: match.player_2_name,
            pokemon: p2Stats.map((s) => ({
              pokemon_name: s.pokemon_name,
              kos_dealt: s.kos_dealt,
              was_koed: s.was_koed,
            })),
          },
        ],
      };
    });
}
