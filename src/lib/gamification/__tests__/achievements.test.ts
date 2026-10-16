import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AchievementDefinition, AchievementCriteria } from '@/types/achievement';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/achievements', () => ({
  getPlayerAchievementKeys: vi.fn(),
  listAchievementDefinitions: vi.fn(),
  upsertPlayerAchievement: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAllTimePlayerAggregates: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  getMatchesByRound: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getPlayerRating: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/signatures', () => ({
  getPlayerSignatures: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/streaks', () => ({
  getPlayerStreaks: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getParticipants: vi.fn(),
  getTournamentsByPlayer: vi.fn(),
}));

import {
  getPlayerAchievementKeys,
  listAchievementDefinitions,
  upsertPlayerAchievement,
} from '@/lib/supabase/queries/achievements';
import { getAllTimePlayerAggregates } from '@/lib/supabase/queries/aggregates';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getRoundById, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getParticipants, getTournamentsByPlayer } from '@/lib/supabase/queries/tournaments';
import { checkAchievements } from '../achievements';
import type { MatchContext } from '../achievements';

// ── Helpers ────────────────────────────────────────────────────────

const PLAYER_ID = 'player-1';
const OPPONENT_ID = 'player-2';

function makeMatchContext(overrides?: Partial<MatchContext>): MatchContext {
  return {
    match_id: 'match-1',
    tournament_id: 'tournament-1',
    season_id: 'season-1',
    winner_id: PLAYER_ID,
    loser_id: OPPONENT_ID,
    is_draw: false,
    ...overrides,
  };
}

function makeDef(
  key: string,
  criteria: AchievementCriteria,
  overrides?: Partial<AchievementDefinition>
): AchievementDefinition {
  return {
    id: `def-${key}`,
    key,
    name: `Achievement ${key}`,
    description: `Desc ${key}`,
    icon: null,
    category: 'combat',
    tier: 'bronze',
    repeatable: false,
    hidden: false,
    criteria,
    ...overrides,
  };
}

function setupDefaultMocks() {
  vi.mocked(getAllTimePlayerAggregates).mockResolvedValue([]);
  vi.mocked(getPlayerStreaks).mockResolvedValue(null);
  vi.mocked(getPlayerRating).mockResolvedValue(null);
  vi.mocked(getBattleStatsByMatch).mockResolvedValue({});
  vi.mocked(getParticipants).mockResolvedValue([]);
  vi.mocked(getPlayerSignatures).mockResolvedValue(null);
  vi.mocked(getTournamentsByPlayer).mockResolvedValue([]);
  vi.mocked(getMatchById).mockResolvedValue(null);
  vi.mocked(getRoundById).mockResolvedValue(null);
  vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  vi.mocked(getPlayerAchievementKeys).mockResolvedValue(new Set<string>());
  vi.mocked(listAchievementDefinitions).mockResolvedValue([]);
  vi.mocked(upsertPlayerAchievement).mockImplementation(async (_pid, _defId, ctx) => ({
    id: 'pa-1',
    player_id: _pid,
    achievement_id: _defId,
    earned_at: '2025-01-01T00:00:00Z',
    times_earned: 1,
    context: ctx ?? null,
  }));
}

// ── Tests ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

describe('checkAchievements', () => {
  it('returns empty array when no definitions exist', async () => {
    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toEqual([]);
  });

  it('awards a cumulative achievement when threshold is met', async () => {
    const def = makeDef('first_win', { type: 'cumulative', stat: 'total_wins', op: 'gte', value: 1 });
    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);
    vi.mocked(getPlayerRating).mockResolvedValue({
      rating: 1500,
      peak_rating: 1500,
      wins: 1,
      losses: 0,
      draws: 0,
    } as never);

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('first_win');
    expect(upsertPlayerAchievement).toHaveBeenCalledOnce();
  });

  it('does not award cumulative achievement when below threshold', async () => {
    const def = makeDef('veteran', { type: 'cumulative', stat: 'total_wins', op: 'gte', value: 100 });
    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);
    vi.mocked(getPlayerRating).mockResolvedValue({
      rating: 1500,
      peak_rating: 1500,
      wins: 5,
      losses: 3,
      draws: 0,
    } as never);

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toHaveLength(0);
    expect(upsertPlayerAchievement).not.toHaveBeenCalled();
  });

  it('skips non-repeatable achievements already earned', async () => {
    const def = makeDef('first_win', { type: 'cumulative', stat: 'total_wins', op: 'gte', value: 1 });
    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);
    vi.mocked(getPlayerAchievementKeys).mockResolvedValue(new Set(['first_win']));
    vi.mocked(getPlayerRating).mockResolvedValue({
      rating: 1500,
      peak_rating: 1500,
      wins: 10,
      losses: 0,
      draws: 0,
    } as never);

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toHaveLength(0);
  });

  it('re-awards repeatable achievements', async () => {
    const def = makeDef('sweep', {
      type: 'single_match',
      stat: 'kos_dealt_total',
      op: 'gte',
      value: 6,
    }, { repeatable: true });

    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);
    vi.mocked(getPlayerAchievementKeys).mockResolvedValue(new Set(['sweep']));
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({
      'game-1': [
        { game_id: 'game-1', player_id: PLAYER_ID, was_brought: true, was_lead: true, pokemon_name: 'Garchomp', was_koed: false, kos_dealt: 6 },
      ],
    } as never);

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('sweep');
  });

  it('awards streak achievement when streak threshold is met', async () => {
    const def = makeDef('hot_streak', { type: 'streak', stat: 'win_streak', op: 'gte', value: 5 });
    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);
    vi.mocked(getPlayerStreaks).mockResolvedValue({
      id: 's-1',
      player_id: PLAYER_ID,
      current_win_streak: 5,
      best_win_streak: 5,
      current_loss_streak: 0,
      best_loss_streak: 2,
      current_ko_streak: 0,
      best_ko_streak: 0,
      current_flawless_streak: 0,
      best_flawless_streak: 0,
      last_match_id: 'match-0',
    });

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('hot_streak');
  });

  it('awards rating achievement when peak rating threshold is met', async () => {
    const def = makeDef('elite', { type: 'rating', stat: 'peak_rating', op: 'gte', value: 1800 });
    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);
    vi.mocked(getPlayerRating).mockResolvedValue({
      rating: 1750,
      peak_rating: 1800,
      wins: 20,
      losses: 5,
      draws: 0,
    } as never);

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toHaveLength(1);
  });

  it('awards seed_diff achievement when seed difference is large enough', async () => {
    const def = makeDef('giant_killer', { type: 'seed_diff', condition: 'winner_seed_minus_loser_seed', op: 'gte', value: 5 });
    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);
    // player-1 is seed 8, opponent is seed 2 => seedDiff = 8 - 2 = 6
    vi.mocked(getParticipants).mockResolvedValue([
      { id: PLAYER_ID, seed: 8 } as never,
      { id: OPPONENT_ID, seed: 2 } as never,
    ]);

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('giant_killer');
  });

  it('awards meta achievement for used_unique_pokemon', async () => {
    const def = makeDef('diverse_roster', { type: 'meta', condition: 'used_unique_pokemon', op: 'gte', value: 3 });
    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);
    vi.mocked(getAllTimePlayerAggregates).mockResolvedValue([
      { pokemon_name: 'Garchomp', total_brought: 1, total_kos_dealt: 2 },
      { pokemon_name: 'Tyranitar', total_brought: 1, total_kos_dealt: 1 },
      { pokemon_name: 'Dragonite', total_brought: 1, total_kos_dealt: 3 },
    ] as never);

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toHaveLength(1);
  });

  it('awards single_match kos_lost_total lte achievement for flawless victory', async () => {
    const def = makeDef('flawless', {
      type: 'single_match',
      stat: 'kos_lost_total',
      op: 'lte',
      value: 0,
    });
    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({
      'game-1': [
        { game_id: 'game-1', player_id: PLAYER_ID, was_brought: true, was_lead: true, pokemon_name: 'Garchomp', was_koed: false, kos_dealt: 3 },
      ],
    } as never);

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('flawless');
  });

  it('awards tournament_champ when player wins the final round', async () => {
    const def = makeDef('tournament_champ', { type: 'cumulative', stat: 'total_wins', op: 'gte', value: 0 });
    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);
    vi.mocked(getMatchById).mockResolvedValue({ id: 'match-1', round_id: 'round-5' } as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-5', round_number: 5 } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { id: 'round-1', round_number: 1 },
      { id: 'round-5', round_number: 5 },
    ] as never);

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('tournament_champ');
  });

  it('returns unknown criteria type as not passed', async () => {
    const def = makeDef('mystery', { type: 'unknown_type' } as never);
    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toHaveLength(0);
  });

  it('awards multiple achievements in a single check', async () => {
    const defs = [
      makeDef('first_win', { type: 'cumulative', stat: 'total_wins', op: 'gte', value: 1 }),
      makeDef('flawless', { type: 'single_match', stat: 'kos_lost_total', op: 'lte', value: 0 }),
    ];
    vi.mocked(listAchievementDefinitions).mockResolvedValue(defs);
    vi.mocked(getPlayerRating).mockResolvedValue({
      rating: 1500, peak_rating: 1500, wins: 1, losses: 0, draws: 0,
    } as never);

    const result = await checkAchievements(PLAYER_ID, makeMatchContext());
    expect(result).toHaveLength(2);
    expect(upsertPlayerAchievement).toHaveBeenCalledTimes(2);
  });

  it('passes correct context to upsertPlayerAchievement', async () => {
    const def = makeDef('first_win', { type: 'cumulative', stat: 'total_wins', op: 'gte', value: 1 });
    vi.mocked(listAchievementDefinitions).mockResolvedValue([def]);
    vi.mocked(getPlayerRating).mockResolvedValue({
      rating: 1500, peak_rating: 1500, wins: 1, losses: 0, draws: 0,
    } as never);

    await checkAchievements(PLAYER_ID, makeMatchContext());

    expect(upsertPlayerAchievement).toHaveBeenCalledWith(PLAYER_ID, 'def-first_win', {
      match_id: 'match-1',
      tournament_id: 'tournament-1',
      season_id: 'season-1',
    });
  });
});
