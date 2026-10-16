import { describe, it, expect } from 'vitest';
import {
  aggregateTeamFromStats,
  aggregateTeamFromGame,
  computePokemonScore,
  computePokemonScoreForGame,
  computeQuickStats,
  computeQuickStatsForGame,
  computeMatchGamesWon,
  resolveActualTeam,
} from '../aggregation';
import type { BattleStat } from '@/types/game';
import type { GameSummary } from '@/types/match';
import type { PokemonSet } from '@/types/team';

// ── Helpers ──────────────────────────────────────────────────────────

const DEFAULT_STAT_SPREAD = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function makeStat(overrides: Partial<BattleStat> = {}): BattleStat {
  return {
    id: 'stat-1',
    game_id: 'game-1',
    player_id: 'p1',
    pokemon_name: 'Pikachu',
    was_brought: true,
    was_lead: false,
    kos_dealt: 0,
    was_koed: false,
    moves_used: [],
    turns_active: 0,
    match_won: false,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSet(overrides: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: '',
    species: 'Pikachu',
    gender: '',
    item: 'Light Ball',
    ability: 'Static',
    evs: { ...DEFAULT_STAT_SPREAD },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Timid',
    level: 100,
    moves: ['Thunderbolt', 'Volt Switch', 'Surf', 'Nasty Plot'],
    ...overrides,
  };
}

// ── aggregateTeamFromStats ──────────────────────────────────────────

describe('aggregateTeamFromStats', () => {
  it('returns empty array when no stats exist for the player', () => {
    const result = aggregateTeamFromStats({}, 'p1', false);
    expect(result).toEqual([]);
  });

  it('returns empty array when stats exist but none for the target player', () => {
    const result = aggregateTeamFromStats(
      { 'game-1': [makeStat({ player_id: 'p2' })] },
      'p1',
      false,
    );
    expect(result).toEqual([]);
  });

  it('aggregates a single pokemon from one game', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({
          pokemon_name: 'Pikachu',
          kos_dealt: 2,
          was_brought: true,
          was_lead: true,
          was_koed: false,
          moves_used: ['Thunderbolt', 'Volt Switch'],
          turns_active: 5,
        }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', false);
    expect(result).toHaveLength(1);
    expect(result[0].pokemonName).toBe('Pikachu');
    expect(result[0].totalKos).toBe(2);
    expect(result[0].timesBrought).toBe(1);
    expect(result[0].wasLead).toBe(true);
    expect(result[0].wasKoed).toBe(false);
    expect(result[0].totalTurnsActive).toBe(5);
    expect(result[0].movesUsed).toContain('Thunderbolt');
    expect(result[0].movesUsed).toContain('Volt Switch');
    expect(result[0].isMvp).toBe(false);
  });

  it('aggregates the same pokemon across multiple games', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({
          pokemon_name: 'Pikachu',
          kos_dealt: 1,
          was_brought: true,
          was_koed: false,
          moves_used: ['Thunderbolt'],
          turns_active: 3,
        }),
      ],
      'game-2': [
        makeStat({
          game_id: 'game-2',
          pokemon_name: 'Pikachu',
          kos_dealt: 2,
          was_brought: true,
          was_koed: true,
          was_lead: true,
          moves_used: ['Volt Switch'],
          turns_active: 4,
        }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', false);
    expect(result).toHaveLength(1);
    expect(result[0].totalKos).toBe(3);
    expect(result[0].timesBrought).toBe(2);
    expect(result[0].wasKoed).toBe(true);
    expect(result[0].wasLead).toBe(true);
    expect(result[0].totalTurnsActive).toBe(7);
    expect(result[0].movesUsed).toContain('Thunderbolt');
    expect(result[0].movesUsed).toContain('Volt Switch');
    expect(result[0].movesUsed).toHaveLength(2);
  });

  it('groups multiple pokemon separately', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ pokemon_name: 'Pikachu', kos_dealt: 1, was_brought: true }),
        makeStat({ pokemon_name: 'Charizard', kos_dealt: 3, was_brought: true }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', false);
    expect(result).toHaveLength(2);
    const names = result.map((p) => p.pokemonName);
    expect(names).toContain('Pikachu');
    expect(names).toContain('Charizard');
  });

  it('sorts brought pokemon before unbrought', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ pokemon_name: 'Pikachu', was_brought: false, kos_dealt: 0 }),
        makeStat({ pokemon_name: 'Charizard', was_brought: true, kos_dealt: 0 }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', false);
    expect(result[0].pokemonName).toBe('Charizard');
    expect(result[1].pokemonName).toBe('Pikachu');
  });

  it('sorts by timesBrought descending then by totalKos descending', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ pokemon_name: 'Pikachu', was_brought: true, kos_dealt: 1 }),
        makeStat({ pokemon_name: 'Charizard', was_brought: true, kos_dealt: 3 }),
      ],
      'game-2': [
        makeStat({ game_id: 'game-2', pokemon_name: 'Pikachu', was_brought: true, kos_dealt: 0 }),
        makeStat({ game_id: 'game-2', pokemon_name: 'Charizard', was_brought: true, kos_dealt: 0 }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', false);
    // Both brought twice, Charizard has more KOs
    expect(result[0].pokemonName).toBe('Charizard');
    expect(result[1].pokemonName).toBe('Pikachu');
  });

  it('sorts alphabetically when times brought and KOs are equal', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ pokemon_name: 'Charizard', was_brought: true, kos_dealt: 1 }),
        makeStat({ pokemon_name: 'Blastoise', was_brought: true, kos_dealt: 1 }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', false);
    expect(result[0].pokemonName).toBe('Blastoise');
    expect(result[1].pokemonName).toBe('Charizard');
  });

  it('marks MVP for the winner when isWinner is true', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ pokemon_name: 'Pikachu', was_brought: true, kos_dealt: 1 }),
        makeStat({ pokemon_name: 'Charizard', was_brought: true, kos_dealt: 3 }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', true);
    const charizard = result.find((p) => p.pokemonName === 'Charizard');
    const pikachu = result.find((p) => p.pokemonName === 'Pikachu');
    expect(charizard?.isMvp).toBe(true);
    expect(pikachu?.isMvp).toBe(false);
  });

  it('does not mark MVP when isWinner is false', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ pokemon_name: 'Charizard', was_brought: true, kos_dealt: 5 }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', false);
    expect(result[0].isMvp).toBe(false);
  });

  it('MVP tiebreaks on timesBrought then alphabetical', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ pokemon_name: 'Charizard', was_brought: true, kos_dealt: 2 }),
        makeStat({ pokemon_name: 'Blastoise', was_brought: true, kos_dealt: 2 }),
      ],
      'game-2': [
        makeStat({ game_id: 'game-2', pokemon_name: 'Charizard', was_brought: true, kos_dealt: 0 }),
        makeStat({ game_id: 'game-2', pokemon_name: 'Blastoise', was_brought: false, kos_dealt: 0 }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', true);
    // Charizard: 2 KOs, 2 brought. Blastoise: 2 KOs, 1 brought. Charizard wins tiebreak.
    const charizard = result.find((p) => p.pokemonName === 'Charizard');
    const blastoise = result.find((p) => p.pokemonName === 'Blastoise');
    expect(charizard?.isMvp).toBe(true);
    expect(blastoise?.isMvp).toBe(false);
  });

  it('MVP tiebreaks alphabetically when KOs and brought are equal', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ pokemon_name: 'Charizard', was_brought: true, kos_dealt: 2 }),
        makeStat({ pokemon_name: 'Blastoise', was_brought: true, kos_dealt: 2 }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', true);
    // Same KOs, same brought — Blastoise < Charizard alphabetically
    const blastoise = result.find((p) => p.pokemonName === 'Blastoise');
    expect(blastoise?.isMvp).toBe(true);
  });

  it('does not assign MVP if no pokemon were brought', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ pokemon_name: 'Pikachu', was_brought: false, kos_dealt: 0 }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', true);
    expect(result[0].isMvp).toBe(false);
  });

  it('deduplicates moves across games', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [makeStat({ pokemon_name: 'Pikachu', moves_used: ['Thunderbolt', 'Surf'] })],
      'game-2': [
        makeStat({
          game_id: 'game-2',
          pokemon_name: 'Pikachu',
          moves_used: ['Thunderbolt', 'Nasty Plot'],
        }),
      ],
    };
    const result = aggregateTeamFromStats(stats, 'p1', false);
    expect(result[0].movesUsed).toHaveLength(3);
    expect(result[0].movesUsed).toContain('Thunderbolt');
    expect(result[0].movesUsed).toContain('Surf');
    expect(result[0].movesUsed).toContain('Nasty Plot');
  });

  it('wasKoed stays true once set across games', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [makeStat({ pokemon_name: 'Pikachu', was_koed: true })],
      'game-2': [makeStat({ game_id: 'game-2', pokemon_name: 'Pikachu', was_koed: false })],
    };
    const result = aggregateTeamFromStats(stats, 'p1', false);
    expect(result[0].wasKoed).toBe(true);
  });
});

// ── computePokemonScore ─────────────────────────────────────────────

describe('computePokemonScore', () => {
  it('returns 0-0 with no games', () => {
    const result = computePokemonScore({}, 'p1', 'p2');
    expect(result).toEqual({ p1Score: 0, p2Score: 0 });
  });

  it('returns 0-0 when both sides lose equal mons', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ player_id: 'p1', pokemon_name: 'Pikachu', was_koed: true }),
        makeStat({ player_id: 'p2', pokemon_name: 'Gengar', was_koed: true }),
      ],
    };
    const result = computePokemonScore(stats, 'p1', 'p2');
    expect(result).toEqual({ p1Score: 0, p2Score: 0 });
  });

  it('scores survivors for the player who lost fewer mons', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ player_id: 'p1', pokemon_name: 'Pikachu', was_koed: false }),
        makeStat({ player_id: 'p2', pokemon_name: 'Gengar', was_koed: true }),
        makeStat({ player_id: 'p2', pokemon_name: 'Dragonite', was_koed: true }),
        makeStat({ player_id: 'p2', pokemon_name: 'Mewtwo', was_koed: true }),
      ],
    };
    const result = computePokemonScore(stats, 'p1', 'p2');
    // p1 lost 0, p2 lost 3 => p1Score += 3 - 0 = 3
    expect(result.p1Score).toBe(3);
    expect(result.p2Score).toBe(0);
  });

  it('accumulates scores across multiple games', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ player_id: 'p1', pokemon_name: 'Pikachu', was_koed: true }),
        makeStat({ player_id: 'p2', pokemon_name: 'Gengar', was_koed: true }),
        makeStat({ player_id: 'p2', pokemon_name: 'Dragonite', was_koed: true }),
      ],
      'game-2': [
        makeStat({ player_id: 'p1', pokemon_name: 'Charizard', was_koed: true }),
        makeStat({ player_id: 'p1', pokemon_name: 'Blastoise', was_koed: true }),
        makeStat({ player_id: 'p2', pokemon_name: 'Gengar', was_koed: true }),
      ],
    };
    const result = computePokemonScore(stats, 'p1', 'p2');
    // Game 1: p1=1 KO'd, p2=2 KO'd => p1Score += 1
    // Game 2: p1=2 KO'd, p2=1 KO'd => p2Score += 1
    expect(result.p1Score).toBe(1);
    expect(result.p2Score).toBe(1);
  });

  it('ignores stats from other players', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ player_id: 'p1', pokemon_name: 'Pikachu', was_koed: true }),
        makeStat({ player_id: 'p2', pokemon_name: 'Gengar', was_koed: true }),
        makeStat({ player_id: 'p3', pokemon_name: 'Mewtwo', was_koed: true }),
      ],
    };
    const result = computePokemonScore(stats, 'p1', 'p2');
    expect(result).toEqual({ p1Score: 0, p2Score: 0 });
  });
});

// ── computeQuickStats ───────────────────────────────────────────────

describe('computeQuickStats', () => {
  it('returns zeros with no games', () => {
    const result = computeQuickStats({}, 'p1', 'p2');
    expect(result).toEqual({ p1TotalKos: 0, p2TotalKos: 0, gamesPlayed: 0 });
  });

  it('sums KOs from flat stats across all games', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ player_id: 'p1', pokemon_name: 'Pikachu', kos_dealt: 2 }),
        makeStat({ player_id: 'p1', pokemon_name: 'Charizard', kos_dealt: 1 }),
        makeStat({ player_id: 'p2', pokemon_name: 'Gengar', kos_dealt: 3 }),
      ],
      'game-2': [
        makeStat({ player_id: 'p1', pokemon_name: 'Pikachu', kos_dealt: 1 }),
        makeStat({ player_id: 'p2', pokemon_name: 'Dragonite', kos_dealt: 2 }),
      ],
    };
    const result = computeQuickStats(stats, 'p1', 'p2');
    expect(result.p1TotalKos).toBe(4);
    expect(result.p2TotalKos).toBe(5);
    expect(result.gamesPlayed).toBe(2);
  });

  it('ignores stats from third-party players', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ player_id: 'p1', kos_dealt: 1 }),
        makeStat({ player_id: 'p3', kos_dealt: 99 }),
      ],
    };
    const result = computeQuickStats(stats, 'p1', 'p2');
    expect(result.p1TotalKos).toBe(1);
    expect(result.p2TotalKos).toBe(0);
  });

  it('counts games from object keys', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [],
      'game-2': [],
      'game-3': [],
    };
    const result = computeQuickStats(stats, 'p1', 'p2');
    expect(result.gamesPlayed).toBe(3);
  });
});

// ── computeMatchGamesWon ────────────────────────────────────────────

function makeGameSummary(overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    id: 'game-1',
    game_number: 1,
    winner_id: null,
    replay_url: '',
    source: 'manual',
    stats_locked: false,
    ...overrides,
  };
}

describe('computeMatchGamesWon', () => {
  it('returns 0-0 for empty games', () => {
    expect(computeMatchGamesWon([], 'p1', 'p2')).toEqual({ p1: 0, p2: 0 });
  });

  it('counts games won per player (2-1)', () => {
    const games: GameSummary[] = [
      makeGameSummary({ id: 'g1', game_number: 1, winner_id: 'p1' }),
      makeGameSummary({ id: 'g2', game_number: 2, winner_id: 'p2' }),
      makeGameSummary({ id: 'g3', game_number: 3, winner_id: 'p1' }),
    ];
    expect(computeMatchGamesWon(games, 'p1', 'p2')).toEqual({ p1: 2, p2: 1 });
  });

  it('skips ties (winner_id null)', () => {
    const games: GameSummary[] = [
      makeGameSummary({ winner_id: 'p1' }),
      makeGameSummary({ id: 'g2', winner_id: null }),
    ];
    expect(computeMatchGamesWon(games, 'p1', 'p2')).toEqual({ p1: 1, p2: 0 });
  });

  it('skips foreign winner_id', () => {
    const games: GameSummary[] = [
      makeGameSummary({ winner_id: 'p3' }),
      makeGameSummary({ id: 'g2', winner_id: 'p1' }),
    ];
    expect(computeMatchGamesWon(games, 'p1', 'p2')).toEqual({ p1: 1, p2: 0 });
  });
});

// ── per-game helpers (delegation) ───────────────────────────────────

describe('per-game aggregation helpers', () => {
  const singleGameStats: BattleStat[] = [
    makeStat({ player_id: 'p1', pokemon_name: 'Pikachu', kos_dealt: 2, was_brought: true }),
    makeStat({ player_id: 'p2', pokemon_name: 'Gengar', was_koed: true }),
    makeStat({ player_id: 'p2', pokemon_name: 'Dragonite', was_koed: true }),
    makeStat({ player_id: 'p2', pokemon_name: 'Mewtwo', was_koed: true }),
  ];
  const wrapped = { 'game-1': singleGameStats };

  it('aggregateTeamFromGame matches aggregateTeamFromStats for one game', () => {
    const fromGame = aggregateTeamFromGame(singleGameStats, 'p1', true);
    const fromStats = aggregateTeamFromStats(wrapped, 'p1', true);
    expect(fromGame).toEqual(fromStats);
  });

  it('computePokemonScoreForGame matches computePokemonScore for one game', () => {
    const fromGame = computePokemonScoreForGame(singleGameStats, 'p1', 'p2');
    const fromStats = computePokemonScore(wrapped, 'p1', 'p2');
    expect(fromGame).toEqual(fromStats);
  });

  it('computeQuickStatsForGame matches computeQuickStats for one game', () => {
    const fromGame = computeQuickStatsForGame(singleGameStats, 'p1', 'p2');
    const fromStats = computeQuickStats(wrapped, 'p1', 'p2');
    expect(fromGame).toEqual(fromStats);
  });
});

// ── resolveActualTeam ───────────────────────────────────────────────

describe('resolveActualTeam', () => {
  it('returns null when no stats exist for the player', () => {
    const result = resolveActualTeam({}, 'p1', []);
    expect(result).toBeNull();
  });

  it('returns null when stats exist only for other players', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [makeStat({ player_id: 'p2' })],
    };
    const result = resolveActualTeam(stats, 'p1', []);
    expect(result).toBeNull();
  });

  it('uses planned set details when species match (case-insensitive)', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({
          player_id: 'p1',
          pokemon_name: 'pikachu',
          moves_used: ['Thunderbolt'],
        }),
      ],
    };
    const planned = [makeSet({ species: 'Pikachu', item: 'Light Ball' })];
    const result = resolveActualTeam(stats, 'p1', planned);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].item).toBe('Light Ball');
    expect(result![0].ability).toBe('Static');
    // Species should use the battle_stats version
    expect(result![0].species).toBe('pikachu');
  });

  it('creates stub set when species is not in planned team', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({
          player_id: 'p1',
          pokemon_name: 'Gengar',
          moves_used: ['Shadow Ball', 'Sludge Bomb'],
        }),
      ],
    };
    const planned = [makeSet({ species: 'Pikachu' })];
    const result = resolveActualTeam(stats, 'p1', planned);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].species).toBe('Gengar');
    expect(result![0].name).toBe('');
    expect(result![0].item).toBe('');
    expect(result![0].ability).toBe('');
    expect(result![0].nature).toBe('');
    expect(result![0].level).toBe(100);
    expect(result![0].moves).toContain('Shadow Ball');
    expect(result![0].moves).toContain('Sludge Bomb');
    expect(result![0].ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
    expect(result![0].evs).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
  });

  it('aggregates moves from multiple games into stub set', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ player_id: 'p1', pokemon_name: 'Gengar', moves_used: ['Shadow Ball'] }),
      ],
      'game-2': [
        makeStat({
          game_id: 'game-2',
          player_id: 'p1',
          pokemon_name: 'Gengar',
          moves_used: ['Sludge Bomb', 'Shadow Ball'],
        }),
      ],
    };
    const result = resolveActualTeam(stats, 'p1', []);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].moves).toContain('Shadow Ball');
    expect(result![0].moves).toContain('Sludge Bomb');
    // Shadow Ball should be deduplicated
    expect(result![0].moves).toHaveLength(2);
  });

  it('returns mix of planned and stub sets', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ player_id: 'p1', pokemon_name: 'Pikachu', moves_used: [] }),
        makeStat({ player_id: 'p1', pokemon_name: 'Gengar', moves_used: ['Shadow Ball'] }),
      ],
    };
    const planned = [makeSet({ species: 'Pikachu' })];
    const result = resolveActualTeam(stats, 'p1', planned);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    const pikachu = result!.find((p) => p.species === 'Pikachu');
    const gengar = result!.find((p) => p.species === 'Gengar');
    expect(pikachu?.item).toBe('Light Ball'); // from planned
    expect(gengar?.item).toBe(''); // stub
  });

  it('handles multiple species in planned team correctly', () => {
    const stats: Record<string, BattleStat[]> = {
      'game-1': [
        makeStat({ player_id: 'p1', pokemon_name: 'Pikachu', moves_used: [] }),
        makeStat({ player_id: 'p1', pokemon_name: 'Charizard', moves_used: [] }),
      ],
    };
    const planned = [
      makeSet({ species: 'Pikachu', item: 'Light Ball' }),
      makeSet({ species: 'Charizard', item: 'Choice Specs' }),
    ];
    const result = resolveActualTeam(stats, 'p1', planned);
    expect(result).toHaveLength(2);
    const pikachu = result!.find((p) => p.species === 'Pikachu');
    const charizard = result!.find((p) => p.species === 'Charizard');
    expect(pikachu?.item).toBe('Light Ball');
    expect(charizard?.item).toBe('Choice Specs');
  });
});
