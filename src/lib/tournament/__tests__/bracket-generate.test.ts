import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/rounds', () => ({
  createRound: vi.fn(async (input: { round_number: number; name: string }) => ({
    id: `round-${input.round_number}`,
    tournament_id: 't1',
    name: input.name,
    round_number: input.round_number,
    best_of: 3,
    status: 'pending',
    pairings_generated: true,
    deadline: null,
    bracket_side: 'winners',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })),
  getRoundsByTournament: vi.fn(),
  updateRoundStatus: vi.fn(),
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

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  freezeEnrollment: vi.fn(),
  updateTournament: vi.fn(),
}));

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  resetMatch: vi.fn(async () => ({
    games_deleted: 1,
    has_downstream_matches: false,
    evolution_events: [],
  })),
}));

vi.mock('@/lib/supabase/client', () => {
  const eq = vi.fn(async () => ({ error: null }));
  const inn = vi.fn(async () => ({ error: null }));
  const del = vi.fn(() => ({ eq, in: inn }));
  return {
    supabase: {
      from: vi.fn(() => ({ delete: del })),
    },
  };
});

import {
  generateEliminationBracket,
  isPlayedBracketMatch,
  regenerateEliminationBracket,
} from '../bracket-generate';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { createRound, getRoundsByTournament, updateRoundStatus } from '@/lib/supabase/queries/rounds';
import { createMatchBatch, getMatchById, getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { updateTournament } from '@/lib/supabase/queries/tournaments';
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
  });

  it('resets played matches then regenerates when cascade is true', async () => {
    const played = makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' });
    vi.mocked(getRoundsByTournament)
      .mockResolvedValueOnce(existingRounds)
      .mockResolvedValue([]);
    vi.mocked(getMatchesByTournament)
      .mockResolvedValueOnce([played])
      .mockResolvedValue([]);
    vi.mocked(getMatchById).mockResolvedValue(played);

    const result = await regenerateEliminationBracket(
      makeTournament(),
      makeParticipants(2),
      { cascade: true, adminId: 'admin-1' }
    );

    expect(resetMatch).toHaveBeenCalledWith('m-played', 'admin-1', true);
    expect(result.rounds_created).toBeGreaterThan(0);
  });

  it('reports format_revert_failed when a reset played match could not take back the format effects', async () => {
    const played = makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' });
    vi.mocked(getRoundsByTournament)
      .mockResolvedValueOnce(existingRounds)
      .mockResolvedValue([]);
    vi.mocked(getMatchesByTournament)
      .mockResolvedValueOnce([played])
      .mockResolvedValue([]);
    vi.mocked(getMatchById).mockResolvedValue(played);
    vi.mocked(resetMatch).mockResolvedValueOnce({
      games_deleted: 1,
      has_downstream_matches: false,
      evolution_events: [],
      format_revert_failed: true,
    });

    const result = await regenerateEliminationBracket(
      makeTournament(),
      makeParticipants(2),
      { cascade: true, adminId: 'admin-1' }
    );

    expect(result.rounds_created).toBeGreaterThan(0);
    expect(result.format_revert_failed).toBe(true);
  });

  it('omits format_revert_failed when the resets reverted cleanly', async () => {
    const played = makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' });
    vi.mocked(getRoundsByTournament)
      .mockResolvedValueOnce(existingRounds)
      .mockResolvedValue([]);
    vi.mocked(getMatchesByTournament)
      .mockResolvedValueOnce([played])
      .mockResolvedValue([]);
    vi.mocked(getMatchById).mockResolvedValue(played);

    const result = await regenerateEliminationBracket(
      makeTournament(),
      makeParticipants(2),
      { cascade: true, adminId: 'admin-1' }
    );

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
    expect(updateRoundStatus).not.toHaveBeenCalled();
  });

  it('stops at the first round insert that loses a race (409 rounds_round_already_written), writing no match', async () => {
    vi.mocked(createRound).mockRejectedValueOnce(
      new UserFacingError('Round 1 already exists with its matches. Delete it to generate it again.', {
        code: 'rounds_round_already_written',
        params: { round: 'Round 1' },
        status: 409,
      }),
    );

    await expect(generateEliminationBracket(makeTournament(), makeParticipants(4))).rejects.toMatchObject({
      code: 'rounds_round_already_written',
      statusCode: 409,
    });
    expect(createRound).toHaveBeenCalledTimes(1);
    expect(createMatchBatch).not.toHaveBeenCalled();
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it('refuses fewer than 2 participants with the typed tournament_participants_too_few (400)', async () => {
    const attempt = generateEliminationBracket(makeTournament(), makeParticipants(1));

    await expect(attempt).rejects.toBeInstanceOf(UserFacingError);
    await expect(attempt).rejects.toMatchObject({
      message: 'Need at least 2 participants',
      code: 'tournament_participants_too_few',
      statusCode: 400,
    });
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

  it('startFirstRound marks the first round active and reports started_round_id', async () => {
    vi.mocked(updateRoundStatus).mockResolvedValue({} as Round);

    const result = await generateEliminationBracket(makeTournament(), makeParticipants(4), {
      startFirstRound: true,
    });

    expect(updateRoundStatus).toHaveBeenCalledTimes(1);
    expect(updateRoundStatus).toHaveBeenCalledWith('round-1', 'active');
    expect(result.started_round_id).toBe('round-1');
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

  it('regenerateEliminationBracket forwards startFirstRound after the wipe', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds).mockResolvedValue([]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(updateRoundStatus).mockResolvedValue({} as Round);

    const result = await regenerateEliminationBracket(makeTournament(), makeParticipants(4), {
      startFirstRound: true,
    });

    expect(result.started_round_id).toBe('round-1');
  });
});

describe('generateEliminationBracket: the tournament status write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
  });

  it('moves an upcoming tournament to active on its first round', async () => {
    await generateEliminationBracket({ ...makeTournament(), status: 'upcoming', current_round: 0 }, makeParticipants(4));
    const write = vi.mocked(updateTournament).mock.calls.find(([, input]) => input.status !== undefined);
    expect(write?.[0]).toBe('t1');
    expect(write?.[1]).toEqual({ status: 'active', current_round: 1 });
    expect(write?.[2]).toEqual({ from: 'upcoming' });
  });

  it('restarts a completed tournament whose bracket is regenerated, guarded on completed', async () => {
    await generateEliminationBracket({ ...makeTournament(), status: 'completed' }, makeParticipants(4));
    const write = vi.mocked(updateTournament).mock.calls.find(([, input]) => input.status !== undefined);
    expect(write?.[1]).toEqual({ status: 'active', current_round: 1 });
    expect(write?.[2]).toEqual({ from: 'completed' });
  });

  it('keeps a regenerated active tournament active', async () => {
    await generateEliminationBracket(makeTournament(), makeParticipants(4));
    const write = vi.mocked(updateTournament).mock.calls.find(([, input]) => input.status !== undefined);
    expect(write?.[1]).toEqual({ status: 'active', current_round: 1 });
  });
});


describe('bracket status claim: no failure after bracket writes, no overwrite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
  });

  it('a generate whose status moved meanwhile keeps the bracket and the other status, without failing', async () => {
    vi.mocked(updateTournament).mockRejectedValueOnce(
      new UserFacingError('changed', { code: 'tournament_status_changed', status: 409 }),
    );
    const result = await generateEliminationBracket({ ...makeTournament(), status: 'upcoming' }, makeParticipants(4));
    expect(result.rounds_created).toBeGreaterThan(0);
    expect(result.status_moved_elsewhere).toBe(true);
    expect(updateTournament).toHaveBeenCalledTimes(1);
  });

  it('a generate whose status moved meanwhile does not start its first round', async () => {
    vi.mocked(updateTournament).mockRejectedValueOnce(
      new UserFacingError('changed', { code: 'tournament_status_changed', status: 409 }),
    );
    const result = await generateEliminationBracket({ ...makeTournament(), status: 'upcoming' }, makeParticipants(4), {
      startFirstRound: true,
    });
    expect(updateRoundStatus).not.toHaveBeenCalled();
    expect(result.started_round_id).toBeUndefined();
  });

  it('a regenerate keeps the round counter until the old bracket is gone: a failed reset leaves it as it was', async () => {
    const played = makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' });
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([played]);
    vi.mocked(getMatchById).mockResolvedValue(played);
    vi.mocked(resetMatch).mockRejectedValueOnce(new Error('reset failed'));
    await expect(
      regenerateEliminationBracket({ ...makeTournament(), current_round: 2 }, makeParticipants(2), { cascade: true, adminId: 'admin-1' }),
    ).rejects.toThrow('reset failed');
    expect(vi.mocked(updateTournament).mock.calls).toEqual([['t1', { status: 'active', current_round: 2 }, { from: 'active' }]]);
  });

  it('a regenerate of a completed tournament whose first reset refuses restores completed, nothing reset or deleted', async () => {
    const played = makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' });
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([played]);
    vi.mocked(getMatchById).mockResolvedValue(played);
    vi.mocked(resetMatch).mockRejectedValueOnce(new UserFacingError('refused', { code: 'match_already_scheduled', status: 409 }));
    await expect(
      regenerateEliminationBracket({ ...makeTournament(), status: 'completed', current_round: 2 }, makeParticipants(2), {
        cascade: true,
        adminId: 'admin-1',
      }),
    ).rejects.toMatchObject({ code: 'match_already_scheduled' });
    expect(vi.mocked(updateTournament).mock.calls).toEqual([
      ['t1', { status: 'active', current_round: 2 }, { from: 'completed' }],
      ['t1', { status: 'completed' }, { from: 'active' }],
    ]);
    expect(createRound).not.toHaveBeenCalled();
  });

  it('a regenerate keeps a completed tournament active once a reset committed, even when a later reset refuses', async () => {
    const first = makeMatch({ id: 'm-1', status: 'completed', winner_id: 'p1' });
    const second = makeMatch({ id: 'm-2', status: 'completed', winner_id: 'p2' });
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([first, second]);
    vi.mocked(getMatchById).mockImplementation(async (id) => (id === 'm-1' ? first : second));
    vi.mocked(resetMatch)
      .mockResolvedValueOnce({ games_deleted: 1, has_downstream_matches: false, evolution_events: [] })
      .mockRejectedValueOnce(new UserFacingError('refused', { code: 'match_already_scheduled', status: 409 }));
    await expect(
      regenerateEliminationBracket({ ...makeTournament(), status: 'completed', current_round: 2 }, makeParticipants(2), {
        cascade: true,
        adminId: 'admin-1',
      }),
    ).rejects.toMatchObject({ code: 'match_already_scheduled' });
    expect(vi.mocked(updateTournament).mock.calls).toEqual([['t1', { status: 'active', current_round: 2 }, { from: 'completed' }]]);
  });

  it('a generate that moved the status itself does not report it moved elsewhere', async () => {
    const result = await generateEliminationBracket({ ...makeTournament(), status: 'upcoming' }, makeParticipants(4));
    expect(result.status_moved_elsewhere).toBeUndefined();
  });

  it('a regenerate refused for too few participants leaves the status and the bracket untouched', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    await expect(
      regenerateEliminationBracket({ ...makeTournament(), status: 'completed' }, makeParticipants(1)),
    ).rejects.toMatchObject({ code: 'tournament_participants_too_few' });
    expect(updateTournament).not.toHaveBeenCalled();
    expect(resetMatch).not.toHaveBeenCalled();
    expect(createRound).not.toHaveBeenCalled();
  });

  it('a regenerate claims the status before any reset or delete, and a moved status refuses it untouched', async () => {
    const played = makeMatch({ id: 'm-played', status: 'completed', winner_id: 'p1' });
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce(existingRounds);
    vi.mocked(getMatchesByTournament).mockResolvedValueOnce([played]);
    vi.mocked(updateTournament).mockRejectedValueOnce(
      new UserFacingError('changed', { code: 'tournament_status_changed', status: 409 }),
    );
    await expect(
      regenerateEliminationBracket({ ...makeTournament(), current_round: 2 }, makeParticipants(2), { cascade: true, adminId: 'admin-1' }),
    ).rejects.toMatchObject({ code: 'tournament_status_changed' });
    expect(vi.mocked(updateTournament).mock.calls[0]).toEqual(['t1', { status: 'active', current_round: 2 }, { from: 'active' }]);
    expect(resetMatch).not.toHaveBeenCalled();
    expect(createRound).not.toHaveBeenCalled();
  });
});

