import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  rounds: vi.fn(), write: vi.fn(), status: vi.fn(),
  legacy: vi.fn(() => { throw new Error('Legacy bracket persistence was used'); }),
}));

vi.mock('@/lib/supabase/queries/phase-rounds', () => ({
  getRoundsByPhase: db.rounds, writePhaseBracket: db.write, updatePhaseRoundStatus: db.status,
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: db.legacy, writeBracket: db.legacy, updateRoundStatus: db.legacy,
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: db.legacy, getMatchesByTournament: db.legacy, createMatch: db.legacy,
}));
vi.mock('@/lib/pkmn/game-pipeline', () => ({ resetMatch: db.legacy }));

import { createNativeBracketPersistence } from '../bracket-persistence';
import { generateEliminationBracket, type BracketCompetition } from '@/lib/tournament/bracket-generate';
import type { ParticipantWithSeed } from '@/types/tournament';

const phase: BracketCompetition = {
  id: 'native-phase', status: 'upcoming', bracket_type: 'single_elim', best_of_default: 3, bo_overrides: {},
};
const participants: ParticipantWithSeed[] = ['player-a', 'player-b'].map((id, i) => ({
  id, name: `Fixture ${i}`, seed: i + 1, starting_bracket: 'winners',
  discord_id: null, auth_user_id: null, ps_username: '', champions_username: '',
  is_admin: false, is_creator: false, is_guest: true, is_test_account: false,
  joined_date: null, avatar_url: null, avatar_config: null, status: 'active',
  suspended_until: null, ban_reason: null, created_at: '', updated_at: '',
}));

describe('native bracket persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.rounds.mockResolvedValue([]);
    db.write.mockResolvedValue(undefined);
    db.status.mockResolvedValue(undefined);
  });

  it('plans with the pure engine and writes native rounds, matches and status in one call', async () => {
    const results = { getMatches: vi.fn(), getMatch: vi.fn(), resetMatch: vi.fn() };
    const result = await generateEliminationBracket(phase, participants, {}, createNativeBracketPersistence(results));
    expect(result).toMatchObject({ rounds_created: 1, matches_materialized: 1 });
    expect(db.write).toHaveBeenCalledOnce();
    expect(db.write).toHaveBeenCalledWith(expect.objectContaining({
      phase_id: 'native-phase', expected_status: 'upcoming', replace: false, current_round: 1,
      matches: [expect.objectContaining({ player_1_id: 'player-a', player_2_id: 'player-b' })],
    }));
    expect(db.write.mock.calls[0][0]).not.toHaveProperty('tournament_id');
    expect(results.getMatches).not.toHaveBeenCalled();
    expect(db.legacy).not.toHaveBeenCalled();
  });

  it('preserves a native write refusal without a legacy retry or partial round start', async () => {
    const conflict = new Error('Native status CAS refused');
    db.write.mockRejectedValue(conflict);
    const results = { getMatches: vi.fn(), getMatch: vi.fn(), resetMatch: vi.fn() };
    await expect(generateEliminationBracket(phase, participants, { startFirstRound: true }, createNativeBracketPersistence(results))).rejects.toBe(conflict);
    expect(db.status).not.toHaveBeenCalled();
    expect(db.legacy).not.toHaveBeenCalled();
  });
});
