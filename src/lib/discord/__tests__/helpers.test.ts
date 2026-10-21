import { describe, it, expect } from 'vitest';
import type { GamePokemonStats } from '@/types/discord';
import type { MatchWithPlayers } from '@/types/match';
import type { BattleStat } from '@/types/game';
import {
  computePokemonScoreFromGameStats,
  buildGamePokemonStats,
} from '../helpers';

// ─── Test Data Factories ────────────────────────────────────────────

function makeGameStat(overrides: Partial<GamePokemonStats> = {}): GamePokemonStats {
  return {
    game_number: 1,
    winner_id: 'p1',
    players: [
      {
        player_id: 'p1',
        player_name: 'Ash',
        pokemon: [
          { pokemon_name: 'Pikachu', kos_dealt: 2, was_koed: false },
        ],
      },
      {
        player_id: 'p2',
        player_name: 'Misty',
        pokemon: [
          { pokemon_name: 'Starmie', kos_dealt: 0, was_koed: true },
          { pokemon_name: 'Gyarados', kos_dealt: 1, was_koed: true },
        ],
      },
    ],
    ...overrides,
  };
}

function makeMatch(overrides: Partial<MatchWithPlayers> = {}): MatchWithPlayers {
  return {
    id: 'match-1',
    round_id: 'round-1',
    tournament_id: 'tourney-1',
    player_1_id: 'p1',
    player_2_id: 'p2',
    player_1_name: 'Ash',
    player_2_name: 'Misty',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_id: 'p1',
    winner_name: 'Ash',
    status: 'completed',
    submitter_id: null,
    date_played: null,
    notes: '',
    social_image_url: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    round_status: 'active',
    games: [
      { id: 'g1', game_number: 1, winner_id: 'p1', replay_url: '', source: 'manual', stats_locked: false },
      { id: 'g2', game_number: 2, winner_id: 'p1', replay_url: '', source: 'manual', stats_locked: false },
    ],
    ...overrides,
  } as MatchWithPlayers;
}

// ─── computePokemonScoreFromGameStats ───────────────────────────────

describe('computePokemonScoreFromGameStats', () => {
  it('returns 0-0 for empty game stats', () => {
    const result = computePokemonScoreFromGameStats([], 'Ash', 'Misty');
    expect(result).toEqual({ p1: 0, p2: 0 });
  });

  it('awards survivors to the winner of each game', () => {
    const games: GamePokemonStats[] = [
      makeGameStat({
        game_number: 1,
        players: [
          {
            player_id: 'p1',
            player_name: 'Ash',
            pokemon: [
              { pokemon_name: 'Pikachu', kos_dealt: 3, was_koed: false },
            ],
          },
          {
            player_id: 'p2',
            player_name: 'Misty',
            pokemon: [
              { pokemon_name: 'Starmie', kos_dealt: 0, was_koed: true },
              { pokemon_name: 'Gyarados', kos_dealt: 1, was_koed: true },
              { pokemon_name: 'Psyduck', kos_dealt: 0, was_koed: true },
            ],
          },
        ],
      }),
    ];

    // p2 has 3 KO'd, p1 has 0 KO'd. p2Koed(3) > p1Koed(0), so p1 gets 3-0 = 3
    const result = computePokemonScoreFromGameStats(games, 'Ash', 'Misty');
    expect(result.p1).toBe(3);
    expect(result.p2).toBe(0);
  });

  it('accumulates scores across multiple games', () => {
    const games: GamePokemonStats[] = [
      makeGameStat({
        game_number: 1,
        players: [
          {
            player_id: 'p1',
            player_name: 'Ash',
            pokemon: [
              { pokemon_name: 'Pikachu', kos_dealt: 2, was_koed: false },
            ],
          },
          {
            player_id: 'p2',
            player_name: 'Misty',
            pokemon: [
              { pokemon_name: 'Starmie', kos_dealt: 0, was_koed: true },
              { pokemon_name: 'Gyarados', kos_dealt: 0, was_koed: true },
            ],
          },
        ],
      }),
      makeGameStat({
        game_number: 2,
        players: [
          {
            player_id: 'p1',
            player_name: 'Ash',
            pokemon: [
              { pokemon_name: 'Pikachu', kos_dealt: 0, was_koed: true },
              { pokemon_name: 'Charizard', kos_dealt: 0, was_koed: true },
            ],
          },
          {
            player_id: 'p2',
            player_name: 'Misty',
            pokemon: [
              { pokemon_name: 'Starmie', kos_dealt: 2, was_koed: false },
            ],
          },
        ],
      }),
    ];

    // Game 1: p2 has 2 KO'd, p1 has 0 -> p1 gets 2
    // Game 2: p1 has 2 KO'd, p2 has 0 -> p2 gets 2
    const result = computePokemonScoreFromGameStats(games, 'Ash', 'Misty');
    expect(result.p1).toBe(2);
    expect(result.p2).toBe(2);
  });

  it('handles tied KO counts in a game (no survivors awarded)', () => {
    const games: GamePokemonStats[] = [
      makeGameStat({
        game_number: 1,
        players: [
          {
            player_id: 'p1',
            player_name: 'Ash',
            pokemon: [
              { pokemon_name: 'Pikachu', kos_dealt: 1, was_koed: true },
            ],
          },
          {
            player_id: 'p2',
            player_name: 'Misty',
            pokemon: [
              { pokemon_name: 'Starmie', kos_dealt: 1, was_koed: true },
            ],
          },
        ],
      }),
    ];

    // Both have 1 KO'd, equal -> no survivors awarded
    const result = computePokemonScoreFromGameStats(games, 'Ash', 'Misty');
    expect(result.p1).toBe(0);
    expect(result.p2).toBe(0);
  });

  it('ignores players not matching provided names', () => {
    const games: GamePokemonStats[] = [
      makeGameStat({
        game_number: 1,
        players: [
          {
            player_id: 'p3',
            player_name: 'Brock',
            pokemon: [
              { pokemon_name: 'Onix', kos_dealt: 3, was_koed: false },
            ],
          },
          {
            player_id: 'p4',
            player_name: 'Gary',
            pokemon: [
              { pokemon_name: 'Arcanine', kos_dealt: 0, was_koed: true },
            ],
          },
        ],
      }),
    ];

    // Neither player matches -> both get 0
    const result = computePokemonScoreFromGameStats(games, 'Ash', 'Misty');
    expect(result.p1).toBe(0);
    expect(result.p2).toBe(0);
  });
});

// ─── buildGamePokemonStats ──────────────────────────────────────────

describe('buildGamePokemonStats', () => {
  it('returns empty array when match has no games', () => {
    const match = makeMatch({ games: [] });
    const result = buildGamePokemonStats(match, {});
    expect(result).toEqual([]);
  });

  it('sorts output by game_number', () => {
    const match = makeMatch({
      games: [
        { id: 'g2', game_number: 2, winner_id: 'p1', replay_url: '', source: 'manual', stats_locked: false },
        { id: 'g1', game_number: 1, winner_id: 'p2', replay_url: '', source: 'manual', stats_locked: false },
        { id: 'g3', game_number: 3, winner_id: 'p1', replay_url: '', source: 'manual', stats_locked: false },
      ],
    });

    const result = buildGamePokemonStats(match, {});
    expect(result.map((g) => g.game_number)).toEqual([1, 2, 3]);
  });

  it('maps battle stats to correct players', () => {
    const match = makeMatch();
    const statsByGame: Record<string, BattleStat[]> = {
      g1: [
        {
          id: 's1', game_id: 'g1', player_id: 'p1',
          pokemon_name: 'Pikachu', kos_dealt: 2, was_koed: false,
          was_lead: true, turns_active: 5,
          moves_used: ['Thunderbolt'], created_at: '',
        } as BattleStat,
        {
          id: 's2', game_id: 'g1', player_id: 'p2',
          pokemon_name: 'Starmie', kos_dealt: 0, was_koed: true,
          was_lead: true, turns_active: 3,
          moves_used: ['Surf'], created_at: '',
        } as BattleStat,
      ],
    };

    const result = buildGamePokemonStats(match, statsByGame);

    expect(result[0].game_number).toBe(1);
    expect(result[0].winner_id).toBe('p1');
    expect(result[0].players[0].player_name).toBe('Ash');
    expect(result[0].players[0].pokemon).toHaveLength(1);
    expect(result[0].players[0].pokemon[0].pokemon_name).toBe('Pikachu');
    expect(result[0].players[0].pokemon[0].kos_dealt).toBe(2);
    expect(result[0].players[0].pokemon[0].was_koed).toBe(false);

    expect(result[0].players[1].player_name).toBe('Misty');
    expect(result[0].players[1].pokemon[0].pokemon_name).toBe('Starmie');
  });

  it('returns empty pokemon arrays when no stats exist for a game', () => {
    const match = makeMatch();
    const result = buildGamePokemonStats(match, {});

    expect(result).toHaveLength(2);
    expect(result[0].players[0].pokemon).toEqual([]);
    expect(result[0].players[1].pokemon).toEqual([]);
  });

  it('includes winner_id from game data', () => {
    const match = makeMatch({
      games: [
        { id: 'g1', game_number: 1, winner_id: 'p2', replay_url: '', source: 'manual', stats_locked: false },
      ],
    });

    const result = buildGamePokemonStats(match, {});
    expect(result[0].winner_id).toBe('p2');
  });

  it('handles null winner_id', () => {
    const match = makeMatch({
      games: [
        { id: 'g1', game_number: 1, winner_id: null, replay_url: '', source: 'manual', stats_locked: false },
      ],
    });

    const result = buildGamePokemonStats(match, {});
    expect(result[0].winner_id).toBeNull();
  });
});
