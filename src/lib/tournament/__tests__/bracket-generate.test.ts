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
  isPlayedBracketMatch,
  regenerateEliminationBracket,
} from '../bracket-generate';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getMatchById, getMatchesByTournament } from '@/lib/supabase/queries/matches';
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
