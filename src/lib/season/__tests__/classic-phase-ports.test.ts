import { describe, expect, it, vi } from 'vitest';
import type { Season } from '@/types/season';

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ createSeason: vi.fn(), getSeasonById: vi.fn(), updateSeason: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getStagesBySeasonId: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getCompletedMatchRecords: vi.fn() }));
vi.mock('@/lib/tournament/phase-week-plan', () => ({ getGroupedPhaseWeekPlan: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhasesBySeasonId: vi.fn().mockResolvedValue([{ id: 'phase' }]) }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getRoundsByPhase: vi.fn().mockResolvedValue([
  { id: 'first', round_number: 1, status: 'completed' },
  { id: 'second', round_number: 2, status: 'active' },
]) }));

import { createClassicLeague, nativeClassicLeagueStorage } from '@/lib/league-phase/classic-storage';
import { createNativeEpbPhaseStorage } from '@/lib/league-phase/classic-epb-storage';
import { createSeason } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { getEpbPhaseStatus, getHinrundeScope } from '../epb-phase';
import { startSeasonIfUpcoming } from '../start-season';
import { UserFacingError } from '@/lib/api/user-facing-error';

describe('classic season ports', () => {
  it('creates the same league container without requiring phase SQL', async () => {
    const input = { name: 'Fixture league', format_type: 'singles' as const };
    const season = { id: 'league', ...input } as Season;
    vi.mocked(createSeason).mockResolvedValue(season);
    expect(await createClassicLeague(input, nativeClassicLeagueStorage)).toBe(season);
    expect(createSeason).toHaveBeenCalledWith(input);
  });

  it('starts through the explicit season port with the original CAS guard', async () => {
    const season = { id: 'league', status: 'upcoming' } as Season;
    const storage = { getSeason: vi.fn().mockResolvedValue(season), updateSeason: vi.fn().mockResolvedValue({ ...season, status: 'active' }) };
    expect(await startSeasonIfUpcoming('league', storage)).toBe(true);
    expect(storage.updateSeason).toHaveBeenCalledWith('league', { status: 'active' }, { from: 'upcoming' });
    storage.updateSeason.mockRejectedValue(new UserFacingError('Changed', { code: 'season_status_changed' }));
    expect(await startSeasonIfUpcoming('league', storage)).toBe(false);
  });

  it('reads the native primary phase and rounds with explicit result callbacks', async () => {
    const matches = vi.fn().mockResolvedValue([{ status: 'completed', round_number: 1 }]);
    const storage = createNativeEpbPhaseStorage({ weekPlan: async () => null, matches, completedRecords: async () => [{ round_number: 1 }] });
    const status = await getEpbPhaseStatus('league', storage);
    expect(status).toMatchObject({ phase_id: 'phase', total_rounds: 2, hinrunde_complete: true });
    expect(status).not.toHaveProperty('tournament_id');
    expect(await getHinrundeScope('league', storage)).toEqual({ phase_id: 'phase', last_round: 1 });
    expect(matches).toHaveBeenCalledWith('phase', ['first']);
    expect(getStagesBySeasonId).not.toHaveBeenCalled();
  });

  it('retains planned but unwritten first-half rounds as incomplete', async () => {
    const storage = createNativeEpbPhaseStorage({
      weekPlan: async () => ({ totalWeeks: 8, firstHalfLastWeek: 4 }),
      matches: async () => [{ status: 'completed', round_number: 1 }],
      completedRecords: async () => [{ round_number: 1 }],
    });
    expect(await getEpbPhaseStatus('league', storage)).toMatchObject({ phase_id: 'phase', hinrunde_round_numbers: [1, 2, 3, 4], hinrunde_complete: false });
  });
});
