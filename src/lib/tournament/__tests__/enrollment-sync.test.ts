import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getStagesBySeasonId: vi.fn(),
  getParticipants: vi.fn(),
  replacePhaseParticipants: vi.fn(),
  setEnrollmentSource: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/tournament/season-standings', () => ({
  computeStandingsForSeason: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  getSeasonParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getCompletedMatchRecords: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
}));

import {
  assertEnrollmentSyncAllowed,
  syncStandingsEnrollment,
} from '@/lib/tournament/enrollment-sync';
import {
  getTournamentById,
  getStagesBySeasonId,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';

describe('assertEnrollmentSyncAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'phase-1',
      season_id: 's1',
      enrollment_source: { type: 'standings', source_phase_id: null, synced_at: '', frozen: false },
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  });

  it('throws ENROLLMENT_FROZEN when frozen and force is false', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'phase-1',
      enrollment_source: { type: 'standings', source_phase_id: null, synced_at: '', frozen: true },
    } as never);

    await expect(assertEnrollmentSyncAllowed('phase-1')).rejects.toMatchObject({
      code: 'ENROLLMENT_FROZEN',
    });
  });

  it('throws ENROLLMENT_ROUNDS_EXIST when rounds exist and force is false', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'round-1' }] as never);

    await expect(assertEnrollmentSyncAllowed('phase-1')).rejects.toMatchObject({
      code: 'ENROLLMENT_ROUNDS_EXIST',
    });
  });

  it('allows sync when force is true', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'phase-1',
      enrollment_source: { type: 'standings', source_phase_id: null, synced_at: '', frozen: true },
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'round-1' }] as never);

    await expect(assertEnrollmentSyncAllowed('phase-1', true)).resolves.toBeUndefined();
  });
});

describe('syncStandingsEnrollment guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'phase-1',
      season_id: 's1',
      enrollment_source: { type: 'standings', source_phase_id: null, synced_at: '', frozen: true },
    } as never);
  });

  it('refuses when frozen without force', async () => {
    await expect(syncStandingsEnrollment('s1', 'phase-1')).rejects.toBeInstanceOf(UserFacingError);
  });
});

describe('syncStandingsEnrollment from a source phase with stored byes', () => {
  function arrange(sourceBracketType: 'swiss' | 'round_robin') {
    vi.clearAllMocks();
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'phase-2',
      season_id: 's1',
      advancement_rule: null,
      enrollment_source: null,
    } as never);
    vi.mocked(getSeasonById).mockResolvedValue({ id: 's1', name: 'League' } as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      { id: 'phase-1', name: 'Swiss', stage_order: 1, bracket_type: sourceBracketType },
      { id: 'phase-2', name: 'Finals', stage_order: 2, bracket_type: 'single_elim' },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: 'Bob' },
    ] as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundsByTournament).mockImplementation(async (id) =>
      id === 'phase-1'
        ? ([{ round_number: 1, bye_player_ids: ['p2'] }] as never)
        : ([] as never)
    );
    vi.mocked(computeStandingsForSeason).mockResolvedValue([
      { player_id: 'p2' },
      { player_id: 'p1' },
    ] as never);
  }

  it('ranks a Swiss source phase with its byes scored, like its own standings', async () => {
    arrange('swiss');

    await syncStandingsEnrollment('s1', 'phase-2');

    expect(computeStandingsForSeason).toHaveBeenCalledWith(
      's1',
      ['p1', 'p2'],
      { p1: 'Alice', p2: 'Bob' },
      [],
      {},
      { byes: [{ player_id: 'p2', round_number: 1 }] }
    );
  });

  it('does not score the byes of a round robin source phase', async () => {
    arrange('round_robin');

    await syncStandingsEnrollment('s1', 'phase-2');

    expect(computeStandingsForSeason).toHaveBeenCalledWith(
      's1',
      ['p1', 'p2'],
      { p1: 'Alice', p2: 'Bob' },
      [],
      {},
      { byes: [] }
    );
  });
});
