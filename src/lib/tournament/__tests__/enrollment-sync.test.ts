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

import {
  assertEnrollmentSyncAllowed,
  syncStandingsEnrollment,
} from '@/lib/tournament/enrollment-sync';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';

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
