import type { BattleStat } from '@/types/game';
import type { GameSummary } from '@/types/match';
import type { PokemonSet } from '@/types/team';

export interface AggregatedPokemon {
  pokemonName: string;
  totalKos: number;
  timesBrought: number;
  wasKoed: boolean;
  wasLead: boolean;
  totalTurnsActive: number;
  movesUsed: string[];
  isMvp: boolean;
}

export interface QuickStats {
  p1TotalKos: number;
  p2TotalKos: number;
  gamesPlayed: number;
}

/**
 * Aggregate battle stats across all games for a single player.
 * Groups by pokemon_name, sums KOs, counts games brought, tracks KO'd status.
 * If the player is the winner, marks their top-KO Pokémon as MVP.
 */
export function aggregateTeamFromStats(
  battleStatsByGame: Record<string, BattleStat[]>,
  playerId: string,
  isWinner: boolean,
): AggregatedPokemon[] {
  const allStats = Object.values(battleStatsByGame).flat();
  const playerStats = allStats.filter((s) => s.player_id === playerId);

  interface Grouped {
    totalKos: number;
    timesBrought: number;
    wasKoed: boolean;
    wasLead: boolean;
    totalTurnsActive: number;
    movesUsed: Set<string>;
  }

  const grouped = new Map<string, Grouped>();
  for (const stat of playerStats) {
    const existing = grouped.get(stat.pokemon_name);
    if (existing) {
      existing.totalKos += stat.kos_dealt;
      existing.totalTurnsActive += stat.turns_active;
      if (stat.was_brought) existing.timesBrought += 1;
      if (stat.was_koed) existing.wasKoed = true;
      if (stat.was_lead) existing.wasLead = true;
      for (const m of stat.moves_used) existing.movesUsed.add(m);
    } else {
      grouped.set(stat.pokemon_name, {
        totalKos: stat.kos_dealt,
        timesBrought: stat.was_brought ? 1 : 0,
        wasKoed: stat.was_koed,
        wasLead: stat.was_lead,
        totalTurnsActive: stat.turns_active,
        movesUsed: new Set(stat.moves_used),
      });
    }
  }

  const team = Array.from(grouped.entries())
    .map(([name, data]) => ({
      pokemonName: name,
      totalKos: data.totalKos,
      timesBrought: data.timesBrought,
      wasKoed: data.wasKoed,
      wasLead: data.wasLead,
      totalTurnsActive: data.totalTurnsActive,
      movesUsed: Array.from(data.movesUsed),
      isMvp: false,
    }))
    .sort((a, b) => {
      const aBrought = a.timesBrought > 0 ? 1 : 0;
      const bBrought = b.timesBrought > 0 ? 1 : 0;
      if (aBrought !== bBrought) return bBrought - aBrought;
      if (b.timesBrought !== a.timesBrought) return b.timesBrought - a.timesBrought;
      if (b.totalKos !== a.totalKos) return b.totalKos - a.totalKos;
      return a.pokemonName.localeCompare(b.pokemonName);
    });

  if (isWinner && team.length > 0) {
    const broughtPokemon = team.filter((p) => p.timesBrought > 0);
    if (broughtPokemon.length > 0) {
      // MVP = highest KO count among brought Pokémon (tiebreak: most brought, then alphabetical)
      const mvp = broughtPokemon.reduce((best, curr) => {
        if (curr.totalKos > best.totalKos) return curr;
        if (curr.totalKos === best.totalKos && curr.timesBrought > best.timesBrought) return curr;
        if (
          curr.totalKos === best.totalKos &&
          curr.timesBrought === best.timesBrought &&
          curr.pokemonName < best.pokemonName
        )
          return curr;
        return best;
      });
      mvp.isMvp = true;
    }
  }

  return team;
}

/**
 * Compute "Pokémon score" — surviving Pokémon per player across all games.
 *
 * The replay parser only marks `was_brought=true` on switch-in, so back-line
 * Pokémon that were selected but never entered the field are missed. Instead
 * we derive survivors per game from KO counts: the loser lost all their mons,
 * so loser's KO'd count = team size brought. Winner's survivors =
 * loser's KO'd count − winner's KO'd count.
 */
export function computePokemonScore(
  battleStatsByGame: Record<string, BattleStat[]>,
  player1Id: string,
  player2Id: string,
): { p1Score: number; p2Score: number } {
  let p1Score = 0;
  let p2Score = 0;

  for (const stats of Object.values(battleStatsByGame)) {
    let p1Koed = 0;
    let p2Koed = 0;

    for (const stat of stats) {
      if (stat.was_koed) {
        if (stat.player_id === player1Id) p1Koed++;
        else if (stat.player_id === player2Id) p2Koed++;
      }
    }

    // The loser's KO'd count = team size (all their mons fainted).
    // Winner's survivors = team size − winner's KO'd.
    // If both sides lost equal mons (shouldn't happen), treat as 0-0.
    if (p1Koed > p2Koed) {
      // p1 lost more → p1 is the loser, p2 is winner
      p2Score += p1Koed - p2Koed;
    } else if (p2Koed > p1Koed) {
      // p2 lost more → p2 is the loser, p1 is winner
      p1Score += p2Koed - p1Koed;
    }
  }

  return { p1Score, p2Score };
}

/**
 * Compute quick aggregate stats for both players across all games.
 */
export function computeQuickStats(
  battleStatsByGame: Record<string, BattleStat[]>,
  player1Id: string,
  player2Id: string,
): QuickStats {
  const allStats = Object.values(battleStatsByGame).flat();
  let p1TotalKos = 0;
  let p2TotalKos = 0;

  for (const stat of allStats) {
    if (stat.player_id === player1Id) p1TotalKos += stat.kos_dealt;
    else if (stat.player_id === player2Id) p2TotalKos += stat.kos_dealt;
  }

  return {
    p1TotalKos,
    p2TotalKos,
    gamesPlayed: Object.keys(battleStatsByGame).length,
  };
}

/** Aggregate battle stats for a single game (delegates to cumulative helper). */
export function aggregateTeamFromGame(
  stats: BattleStat[],
  playerId: string,
  isWinner: boolean,
): AggregatedPokemon[] {
  return aggregateTeamFromStats({ g: stats }, playerId, isWinner);
}

/** Surviving Pokémon score for a single game. */
export function computePokemonScoreForGame(
  stats: BattleStat[],
  player1Id: string,
  player2Id: string,
): { p1Score: number; p2Score: number } {
  return computePokemonScore({ g: stats }, player1Id, player2Id);
}

/** KO totals for a single game. */
export function computeQuickStatsForGame(
  stats: BattleStat[],
  player1Id: string,
  player2Id: string,
): QuickStats {
  return computeQuickStats({ g: stats }, player1Id, player2Id);
}

/** Count games won per player (skips ties and unknown winners). */
export function computeMatchGamesWon(
  games: GameSummary[],
  player1Id: string,
  player2Id: string,
): { p1: number; p2: number } {
  let p1 = 0;
  let p2 = 0;
  for (const game of games) {
    if (game.winner_id === player1Id) p1 += 1;
    else if (game.winner_id === player2Id) p2 += 1;
  }
  return { p1, p2 };
}

// ─── Resolve actual team from battle_stats ──────────────────────────

const DEFAULT_STAT_SPREAD = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/**
 * Build a PokemonSet[] from confirmed battle_stats, enriched with planned team
 * details where species match. For species present in battle_stats but absent
 * from the planned team (e.g. player changed their roster), a minimal stub set
 * is created with moves extracted from battle_stats.
 *
 * Returns null if no battle_stats exist for this player (caller should fall back
 * to planned team).
 */
export function resolveActualTeam(
  battleStatsByGame: Record<string, BattleStat[]>,
  playerId: string,
  plannedTeam: PokemonSet[],
): PokemonSet[] | null {
  const allStats = Object.values(battleStatsByGame).flat();
  const playerStats = allStats.filter((s) => s.player_id === playerId);

  if (playerStats.length === 0) return null;

  // Collect unique species and aggregate moves from all games
  const speciesMap = new Map<string, Set<string>>();
  for (const stat of playerStats) {
    const existing = speciesMap.get(stat.pokemon_name);
    if (existing) {
      for (const m of stat.moves_used) existing.add(m);
    } else {
      speciesMap.set(stat.pokemon_name, new Set(stat.moves_used));
    }
  }

  // Build a lookup from the planned team keyed on lowercase species
  const plannedLookup = new Map<string, PokemonSet>();
  for (const set of plannedTeam) {
    plannedLookup.set(set.species.toLowerCase(), set);
  }

  const result: PokemonSet[] = [];
  for (const [species, movesUsed] of speciesMap) {
    const planned = plannedLookup.get(species.toLowerCase());
    if (planned) {
      // Use full planned set details but ensure species matches battle_stats
      // (handles casing differences)
      result.push({ ...planned, species });
    } else {
      // Species not in planned team — player swapped their roster.
      // Create a minimal stub with whatever info battle_stats provides.
      result.push({
        name: '',
        species,
        gender: '',
        item: '',
        ability: '',
        evs: { ...DEFAULT_STAT_SPREAD },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        nature: '',
        level: 100,
        moves: Array.from(movesUsed),
      });
    }
  }

  return result;
}
