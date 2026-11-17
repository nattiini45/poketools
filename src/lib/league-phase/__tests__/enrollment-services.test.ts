import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrollmentPhase } from '@/lib/tournament/enrollment-sync';
import type { KitStandingsData } from '@/lib/format-engine/context';

const h = vi.hoisted(() => ({ phase: vi.fn(), phases: vi.fn(), participants: vi.fn(), groups: vi.fn(), rounds: vi.fn(),
  replace: vi.fn(), season: vi.fn(), context: vi.fn(), records: vi.fn(), stats: vi.fn(), advance: vi.fn(), kitRead: vi.fn(),
  outcomes: vi.fn(), matchIds: vi.fn(), gameCounts: vi.fn(), kills: vi.fn(),
  legacy: vi.fn(() => { throw new Error('Legacy enrollment reader called'); }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: h.phase, getPhasesBySeasonId: h.phases,
  getPhaseParticipants: h.participants, replacePhaseEnrollment: h.replace }));
vi.mock('@/lib/supabase/queries/phase-groups', () => ({ getGroupsByPhase: h.groups }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getRoundsByPhase: h.rounds }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseStandingsBattleStats: h.stats }));
vi.mock('@/lib/supabase/queries/phase-format-runtime', () => ({ getNativeKitCompletedRecords: h.records,
  getNativeKitOutcomes: h.outcomes, getNativeKitMatchIds: h.matchIds, getNativeKitGameCounts: h.gameCounts, getNativeKitKills: h.kills }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: h.season, getSeasonParticipants: h.legacy }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: h.legacy, getStagesBySeasonId: h.legacy,
  getParticipants: h.legacy, replacePhaseEnrollment: h.legacy }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupsByTournament: h.legacy }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: h.legacy }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getCompletedMatchRecords: h.legacy }));
vi.mock('@/lib/format-engine/advance', () => ({ kitAdvancingPlayers: h.advance }));
vi.mock('../kit-storage', () => ({ nativeKitReadStorage: h.kitRead }));
vi.mock('../standings-context', () => ({ loadNativeSeasonStandingsContext: h.context }));

import { createNativePhaseEnrollment } from '../enrollment-services';

const target: EnrollmentPhase = { id: 'target', season_id: 'league', name: 'Synthetic target', status: 'upcoming',
  bracket_type: 'round_robin', stage_order: 2, advancement_rule: null, enrollment_source: null };
const source: EnrollmentPhase = { ...target, id: 'source', name: 'Synthetic source', status: 'completed', stage_order: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  h.phase.mockImplementation(async id => id === 'source' ? source : target);
  h.phases.mockResolvedValue([source, target]); h.participants.mockImplementation(async id => id === 'source'
    ? [{ id: 'a', name: 'Aster' }, { id: 'b', name: 'Briar' }] : []);
  h.groups.mockResolvedValue([]); h.rounds.mockResolvedValue([]); h.records.mockResolvedValue([]);
  h.replace.mockResolvedValue(true); h.season.mockResolvedValue({ id: 'league', name: 'Synthetic league', format_type: 'custom' });
  h.advance.mockResolvedValue(null); h.stats.mockResolvedValue([]); h.kitRead.mockReturnValue({ native: true });
  const stage = { key: 'stage', scoring: { win: 1, loss: 0, bye: 0 }, rank: [{ kind: 'manual' as const }] };
  const kit: KitStandingsData = { engine: 'kit', stages: { target: stage, source: stage },
    stageOfMatch: {}, outcomes: {}, coinFlips: {}, manualOrder: { target: ['a', 'b'], source: ['b', 'a'] },
    adjustments: { target: { a: 500 } } };
  h.context.mockResolvedValue({ formatType: 'custom', kit });
});

describe('concrete native standings enrollment', () => {
  it('selects the actual source kit stage when it has no completed match, without a fake enrollment writer', async () => {
    const services = createNativePhaseEnrollment();
    expect(h.phase).not.toHaveBeenCalled(); expect(h.records).not.toHaveBeenCalled();
    await services.sync('league', 'target', { source_phase_id: 'source', top_n: 1 });
    expect(h.replace).toHaveBeenCalledWith('target', [{ player_id: 'b', seed: 1 }],
      expect.objectContaining({ source_phase_id: 'source' }), null, false);
    expect(h.advance).toHaveBeenCalledWith(expect.objectContaining({ sourcePhaseId: 'source', targetPhaseId: 'target' }), { native: true });
    expect(h.records).toHaveBeenCalledWith('source'); expect(h.stats).not.toHaveBeenCalled(); expect(h.legacy).not.toHaveBeenCalled();
  });

  it('binds kit edge enrollment to the real source id rather than a tournament alias', async () => {
    h.advance.mockResolvedValue([{ player_id: 'b', seed: 1 }]);
    const result = await createNativePhaseEnrollment().enroll('league', 'target', 'source');
    expect(result.enrolled_count).toBe(1); expect(h.context).not.toHaveBeenCalled();
    expect(h.replace).toHaveBeenCalledWith('target', [{ player_id: 'b', seed: 1 }],
      expect.objectContaining({ contributions: [{ source_phase_id: 'source', player_ids: ['b'] }] }), null, false);
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('reads native round-granular kills and the stored EPB order for non-kit advancement', async () => {
    h.season.mockResolvedValue({ id: 'league', format_type: 'evolution_point_buy' });
    h.context.mockResolvedValue({ formatType: 'evolution_point_buy', evolutionPoints: { a: 0, b: 100 },
      tiebreakerOrder: ['kill_difference', 'evolution_points', 'match_points'] });
    h.stats.mockResolvedValue([{ player_id: 'a', kos_dealt: 5, was_koed: false }]);
    await createNativePhaseEnrollment().sync('league', 'target', { source_phase_id: 'source', top_n: 1 });
    expect(h.replace).toHaveBeenCalledWith('target', [{ player_id: 'a', seed: 1 }], expect.any(Object), null, false);
    expect(h.stats).toHaveBeenCalledExactlyOnceWith('source'); expect(h.advance).not.toHaveBeenCalled();
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('refuses a changed or foreign source owner before an enrollment write', async () => {
    h.phase.mockImplementation(async id => id === 'source' ? { ...source, season_id: 'foreign' } : target);
    await expect(createNativePhaseEnrollment().sync('league', 'target', { source_phase_id: 'source' })).rejects.toThrow('source league mismatch');
    expect(h.replace).not.toHaveBeenCalled();
  });
});
