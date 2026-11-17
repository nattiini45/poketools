import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  phase: vi.fn(), phases: vi.fn(), participants: vi.fn(), groups: vi.fn(), rounds: vi.fn(), replace: vi.fn(),
  legacy: vi.fn(() => { throw new Error('Legacy phase persistence was used'); }),
}));

vi.mock('@/lib/supabase/queries/league-phases', () => ({
  getPhaseById: db.phase, getPhasesBySeasonId: db.phases, getPhaseParticipants: db.participants, replacePhaseEnrollment: db.replace,
}));
vi.mock('@/lib/supabase/queries/phase-groups', () => ({ getGroupsByPhase: db.groups }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getRoundsByPhase: db.rounds }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: db.legacy, getStagesBySeasonId: db.legacy, getParticipants: db.legacy, replacePhaseEnrollment: db.legacy,
}));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupsByTournament: db.legacy }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: db.legacy }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getCompletedMatchRecords: db.legacy }));
vi.mock('@/lib/tournament/season-standings', () => ({ computeStandingsForSeason: db.legacy }));
vi.mock('@/lib/format-engine/advance', () => ({ kitAdvancingPlayers: db.legacy }));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(async () => ({ id: 'league', name: 'Fixture league', format_type: 'singles' })),
  getSeasonParticipants: vi.fn(async () => [{ id: 'player-a' }, { id: 'player-b' }]),
}));

import { createNativeEnrollmentPersistence } from '../enrollment-persistence';
import { syncStandingsEnrollment, type EnrollmentPhase } from '@/lib/tournament/enrollment-sync';

const target: EnrollmentPhase = {
  id: 'target', season_id: 'league', name: 'Fixture target', status: 'upcoming', bracket_type: 'round_robin',
  stage_order: 2, advancement_rule: null, enrollment_source: null,
};

describe('native enrollment persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.phase.mockResolvedValue(target);
    db.phases.mockResolvedValue([target]);
    db.participants.mockResolvedValue([]);
    db.groups.mockResolvedValue([]);
    db.rounds.mockResolvedValue([]);
    db.replace.mockResolvedValue(true);
  });

  it('uses native enrollment writes and shared league roster reads without a tournament fallback', async () => {
    const results = {
      getCompletedMatches: vi.fn(async () => []), computeStandings: vi.fn(async () => []), kitAdvancingPlayers: vi.fn(async () => null),
    };
    const result = await syncStandingsEnrollment('league', 'target', {}, createNativeEnrollmentPersistence(results));
    expect(result.enrolled_count).toBe(2);
    expect(db.replace).toHaveBeenCalledWith('target', [
      { player_id: 'player-a', seed: 1 }, { player_id: 'player-b', seed: 2 },
    ], expect.objectContaining({ type: 'roster', source_phase_id: null }), null, false);
    expect(results.getCompletedMatches).not.toHaveBeenCalled();
    expect(db.legacy).not.toHaveBeenCalled();
  });

  it('retries a lost native enrollment CAS and keeps result loaders explicit', async () => {
    const source: EnrollmentPhase = { ...target, id: 'source', name: 'Fixture source', status: 'completed', stage_order: 1 };
    db.phases.mockResolvedValue([source, target]);
    db.replace.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const results = {
      getCompletedMatches: vi.fn(async () => []), computeStandings: vi.fn(async () => []), kitAdvancingPlayers: vi.fn(async () => null),
    };
    await syncStandingsEnrollment('league', 'target', {}, createNativeEnrollmentPersistence(results));
    expect(db.replace).toHaveBeenCalledTimes(2);
    expect(results.getCompletedMatches).toHaveBeenCalledTimes(2);
    expect(results.computeStandings).toHaveBeenCalledTimes(2);
    expect(db.groups).toHaveBeenCalledWith('source');
    expect(db.rounds).toHaveBeenCalledWith('source');
    expect(db.legacy).not.toHaveBeenCalled();
  });
});
