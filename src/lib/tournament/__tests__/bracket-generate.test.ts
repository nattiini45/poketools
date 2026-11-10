import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
  updateRoundStatus: vi.fn(),
  writeBracket: vi.fn(async (input: { rounds: unknown[]; matches: unknown[] }) => ({
    rounds: input.rounds.length,
    matches: input.matches.length,
  })),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByTournament: vi.fn(),
  getMatchById: vi.fn(),
  createMatchBatch: vi.fn(async () => []),
  updateMatchPlayers: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getGamesByMatch: vi.fn(async () => []),
}));

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  resetMatch: vi.fn(async () => ({
    games_deleted: 1,
    has_downstream_matches: false,
    evolution_events: [],
  })),
}));

import {
  generateEliminationBracket,
  isPlayedBracketMatch,
  regenerateEliminationBracket,
} from '../bracket-generate';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getRoundsByTournament, updateRoundStatus, writeBracket } from '@/lib/supabase/queries/rounds';
import { createMatchBatch, getMatchById, getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { resetMatch } from '@/lib/pkmn/game-pipeline';
import type { MatchWithPlayers } from '@/types/match';
import type { ParticipantWithSeed, Tournament } from '@/types/tournament';
import type { Round } from '@/types/round';

function makeTournament(): Tournament {
  return {
    id: 't1',
    name: 'Test Cup',
    description: '',
    season_id: null,
    bracket_type: 'single_elim',
    ruleset_id: 'ruleset-1',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    status: 'active',
    current_round: 1,
    stage_order: 1,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function makeParticipants(n: number): ParticipantWithSeed[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    seed: i + 1,
    starting_bracket: 'winners',
    discord_id: null,
    auth_user_id: null,
    ps_username: '',
    champions_username: '',
    is_admin: false,
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: null,
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }));
}

function makeMatch(partial: Partial<MatchWithPlayers> & { id: string }): MatchWithPlayers {
  return {
    id: partial.id,
    round_id: partial.round_id ?? 'round-1',
    tournament_id: 't1',
    player_1_id: partial.player_1_id ?? 'p1',
    player_2_id: partial.player_2_id ?? 'p2',
    winner_id: partial.winner_id ?? null,
    status: partial.status ?? 'scheduled',
    submitter_id: null,
    date_played: null,
    scheduled_at: null,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: '',
    social_image_url: null,
    bracket_side: partial.bracket_side ?? 'winners',
    bracket_pos: partial.bracket_pos ?? 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    player_1_name: '',
    player_2_name: '',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: null,
    round_status: 'pending',
    games: partial.games ?? [],
  };
}

const existingRounds: Round[] = [
  {
    id: 'round-1',
    tournament_id: 't1',
    name: 'Finals',
    round_number: 1,
    best_of: 3,
    status: 'active',
    pairings_generated: true,
    deadline: null,
    bracket_side: 'winners',
    bye_player_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

describe('isPlayedBracketMatch', () => {
  it('treats non-scheduled status as played', () => {
    expect(isPlayedBracketMatch(makeMatch({ id: 'm1', status: 'completed' }))).toBe(true);
    expect(isPlayedBracketMatch(makeMatch({ id: 'm2', status: 'in_progress' }))).toBe(true);
  });

  it('treats scheduled matches with games as played', () => {
    expect(
      isPlayedBracketMatch(
        makeMatch({
          id: 'm3',
          status: 'scheduled',
          games: [
            {
              id: 'g1',
              game_number: 1,
              winner_id: 'p1',
              replay_url: '',
              source: 'manual',
              stats_locked: false,
            },
          ],
        })
      )
    ).toBe(true);
  });

  it('treats empty scheduled shells as not played', () => {
    expect(isPlayedBracketMatch(makeMatch({ id: 'm4', status: 'scheduled', games: [] }))).toBe(false);
  });
});

/** The one bracket write of the call (the locked `bracket_write`). */
function written() {
  expect(writeBracket).toHaveBeenCalledTimes(1);
  return vi.mocked(writeBracket).mock.calls[0][0];
}

const firstRoundIdWritten = () => written().rounds.find((round) => round.round_number === 1)?.id;

const statusChanged = () =>
  new UserFacingError('changed', { code: 'tournament_status_changed', params: { from: 'active' }, status: 409 });

describe('regenerateEliminationBracket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses when played matches exist and cascade is false', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' }),
    ]);

    await expect(
      regenerateEliminationBracket(makeTournament(), makeParticipants(2))
    ).rejects.toMatchObject({
      name: 'UserFacingError',
      code: 'REGENERATE_PLAYED',
      params: { count: 1 },
      statusCode: 409,
    });
    expect(resetMatch).not.toHaveBeenCalled();
    expect(writeBracket).not.toHaveBeenCalled();
  });

  it('resets played matches, then replaces the bracket in one locked write', async () => {
    const played = makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' });
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([played]);
    vi.mocked(getMatchById).mockResolvedValue(played);

    const result = await regenerateEliminationBracket(makeTournament(), makeParticipants(2), {
      cascade: true,
      adminId: 'admin-1',
    });

    expect(resetMatch).toHaveBeenCalledWith('m-played', 'admin-1', true);
    expect(vi.mocked(resetMatch).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(writeBracket).mock.invocationCallOrder[0]);
    const write = written();
    expect(write).toMatchObject({ tournament_id: 't1', expected_status: 'active', replace: true, current_round: 1 });
    expect(write.rounds.length).toBeGreaterThan(0);
    expect(write.matches).toHaveLength(1);
    expect(write.matches[0]).toMatchObject({ round_id: firstRoundIdWritten(), player_1_id: 'p1', player_2_id: 'p2' });
    expect(result).toEqual({ rounds_created: write.rounds.length, matches_materialized: 1 });
  });

  it('reports format_revert_failed when a reset played match could not take back the format effects', async () => {
    const played = makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' });
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([played]);
    vi.mocked(getMatchById).mockResolvedValue(played);
    vi.mocked(resetMatch).mockResolvedValueOnce({
      games_deleted: 1,
      has_downstream_matches: false,
      evolution_events: [],
      format_revert_failed: true,
    });

    const result = await regenerateEliminationBracket(makeTournament(), makeParticipants(2), {
      cascade: true,
      adminId: 'admin-1',
    });

    expect(result.rounds_created).toBeGreaterThan(0);
    expect(result.format_revert_failed).toBe(true);
  });

  it('omits format_revert_failed when the resets reverted cleanly', async () => {
    const played = makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' });
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([played]);
    vi.mocked(getMatchById).mockResolvedValue(played);

    const result = await regenerateEliminationBracket(makeTournament(), makeParticipants(2), {
      cascade: true,
      adminId: 'admin-1',
    });

    expect(result).not.toHaveProperty('format_revert_failed');
  });

  it('throws UserFacingError so the route can surface REGENERATE_PLAYED', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      makeMatch({ id: 'm-played', status: 'in_progress' }),
    ]);

    try {
      await regenerateEliminationBracket(makeTournament(), makeParticipants(2), {
        cascade: false,
      });
      throw new Error('expected refusal');
    } catch (err) {
      expect(err).toBeInstanceOf(UserFacingError);
      expect((err as UserFacingError).code).toBe('REGENERATE_PLAYED');
      expect((err as UserFacingError).params).toEqual({ count: 1 });
      expect((err as UserFacingError).message).toContain('played match');
    }
  });

  it('refuses too few participants before any reset or write', async () => {
    const played = makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' });
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([played]);

    await expect(
      regenerateEliminationBracket({ ...makeTournament(), status: 'completed' }, makeParticipants(1), {
        cascade: true,
        adminId: 'admin-1',
      }),
    ).rejects.toMatchObject({ code: 'tournament_participants_too_few' });
    expect(resetMatch).not.toHaveBeenCalled();
    expect(writeBracket).not.toHaveBeenCalled();
  });

  it('a failed reset writes no bracket and no status', async () => {
    const played = makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' });
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([played]);
    vi.mocked(getMatchById).mockResolvedValue(played);
    vi.mocked(resetMatch).mockRejectedValueOnce(new UserFacingError('refused', { code: 'match_already_scheduled', status: 409 }));

    await expect(
      regenerateEliminationBracket({ ...makeTournament(), status: 'completed' }, makeParticipants(2), {
        cascade: true,
        adminId: 'admin-1',
      }),
    ).rejects.toMatchObject({ code: 'match_already_scheduled' });
    expect(writeBracket).not.toHaveBeenCalled();
  });

  it('restarts a completed tournament through the write guarded on completed', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([]);

    await regenerateEliminationBracket({ ...makeTournament(), status: 'completed' }, makeParticipants(4));

    expect(written()).toMatchObject({ expected_status: 'completed', replace: true });
  });

  it('a status moved by another writer refuses the regenerate with nothing started', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([]);
    vi.mocked(writeBracket).mockRejectedValueOnce(statusChanged());

    await expect(
      regenerateEliminationBracket(makeTournament(), makeParticipants(4), { startFirstRound: true }),
    ).rejects.toMatchObject({ code: 'tournament_status_changed' });
    expect(updateRoundStatus).not.toHaveBeenCalled();
  });

  it('forwards startFirstRound after the replace', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([]);
    vi.mocked(updateRoundStatus).mockResolvedValue({} as Round);

    const result = await regenerateEliminationBracket(makeTournament(), makeParticipants(4), {
      startFirstRound: true,
    });

    expect(result.started_round_id).toBe(firstRoundIdWritten());
    expect(updateRoundStatus).toHaveBeenCalledWith(firstRoundIdWritten(), 'active', 'pending');
  });
});

describe('generateEliminationBracket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
  });

  it('refuses a second generation with the typed bracket_already_generated (409)', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue(existingRounds);

    const attempt = generateEliminationBracket(makeTournament(), makeParticipants(4));

    await expect(attempt).rejects.toBeInstanceOf(UserFacingError);
    await expect(attempt).rejects.toMatchObject({
      message: 'Bracket already generated',
      code: 'bracket_already_generated',
      statusCode: 409,
    });
    expect(writeBracket).not.toHaveBeenCalled();
    expect(updateRoundStatus).not.toHaveBeenCalled();
  });

  it('writes the whole bracket in one locked write: rounds, matches and the first round number, no separate insert', async () => {
    const result = await generateEliminationBracket({ ...makeTournament(), status: 'upcoming' }, makeParticipants(4));

    const write = written();
    expect(write).toMatchObject({ tournament_id: 't1', expected_status: 'upcoming', replace: false, current_round: 1 });
    expect(write.rounds.map((round) => round.round_number)).toEqual([1, 2]);
    expect(new Set(write.rounds.map((round) => round.id)).size).toBe(2);
    expect(write.matches).toHaveLength(2);
    for (const match of write.matches) expect(match.round_id).toBe(firstRoundIdWritten());
    expect(createMatchBatch).not.toHaveBeenCalled();
    expect(result).toEqual({ rounds_created: 2, matches_materialized: 2 });
  });

  it('takes the best-of of each round from the overrides', async () => {
    await generateEliminationBracket({ ...makeTournament(), bo_overrides: { Finals: 5 } }, makeParticipants(4));

    const finals = written().rounds.find((round) => round.name === 'Finals');
    expect(finals?.best_of).toBe(5);
  });

  it('a status moved by another writer refuses the generate (409 tournament_status_changed) and starts no round', async () => {
    vi.mocked(writeBracket).mockRejectedValueOnce(statusChanged());

    await expect(
      generateEliminationBracket({ ...makeTournament(), status: 'upcoming' }, makeParticipants(4), { startFirstRound: true }),
    ).rejects.toMatchObject({ code: 'tournament_status_changed' });
    expect(updateRoundStatus).not.toHaveBeenCalled();
  });

  it('refuses fewer than 2 participants with the typed tournament_participants_too_few (400)', async () => {
    const attempt = generateEliminationBracket(makeTournament(), makeParticipants(1));

    await expect(attempt).rejects.toBeInstanceOf(UserFacingError);
    await expect(attempt).rejects.toMatchObject({
      message: 'Need at least 2 participants',
      code: 'tournament_participants_too_few',
      statusCode: 400,
    });
    expect(writeBracket).not.toHaveBeenCalled();
  });

  it('keeps the guard for non-elimination formats as it was', async () => {
    const swiss = { ...makeTournament(), bracket_type: 'swiss' as const };

    await expect(generateEliminationBracket(swiss, makeParticipants(4))).rejects.toThrow(
      'Full bracket generation only applies to elimination formats',
    );
  });

  it('returns exactly the two historic keys and starts nothing by default', async () => {
    const result = await generateEliminationBracket(makeTournament(), makeParticipants(4));

    expect(Object.keys(result).sort()).toEqual(['matches_materialized', 'rounds_created']);
    expect(result.rounds_created).toBeGreaterThan(0);
    expect(updateRoundStatus).not.toHaveBeenCalled();
  });

  it('startFirstRound false behaves like the default', async () => {
    const result = await generateEliminationBracket(makeTournament(), makeParticipants(4), {
      startFirstRound: false,
    });

    expect(Object.keys(result).sort()).toEqual(['matches_materialized', 'rounds_created']);
    expect(updateRoundStatus).not.toHaveBeenCalled();
  });

  it('startFirstRound marks the first round active after the write and reports started_round_id', async () => {
    vi.mocked(updateRoundStatus).mockResolvedValue({} as Round);

    const result = await generateEliminationBracket(makeTournament(), makeParticipants(4), {
      startFirstRound: true,
    });

    expect(updateRoundStatus).toHaveBeenCalledTimes(1);
    expect(updateRoundStatus).toHaveBeenCalledWith(firstRoundIdWritten(), 'active', 'pending');
    expect(vi.mocked(writeBracket).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(updateRoundStatus).mock.invocationCallOrder[0]);
    expect(result.started_round_id).toBe(firstRoundIdWritten());
    expect(result.rounds_created).toBeGreaterThan(1);
  });

  it('a failed start leaves the bracket in place and omits started_round_id', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(updateRoundStatus).mockRejectedValue(new Error('db down'));

    const result = await generateEliminationBracket(makeTournament(), makeParticipants(4), {
      startFirstRound: true,
    });

    expect(result.started_round_id).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(['matches_materialized', 'rounds_created']);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
