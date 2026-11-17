import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phase } from '@/types/league-phase';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';
import type { PhaseFinalizationEffects } from '../finalization';

const ports = vi.hoisted(() => ({
  forbidden: vi.fn(() => { throw new Error('Unexpected database access outside native fixture'); }),
  ratings: {
    loadScope: vi.fn(async () => ({ testSeasonTournamentIds: new Set<string>(), testSeasonPhaseIds: new Set<string>() })),
    getHistoryByMatch: vi.fn(async () => []), getHistoryByMatches: vi.fn(async () => []),
  },
  kills: vi.fn(async () => undefined), matchday: vi.fn(async () => undefined),
  propagate: vi.fn(async () => undefined),
  phaseHistory: vi.fn(async () => []),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: ports.forbidden, rpc: ports.forbidden } }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: vi.fn(), getPhaseParticipants: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: vi.fn(), markPhaseMatchFinalized: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseBattleStatsByMatch: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/queries/phase-match-outcomes', () => ({
  getPhaseMatchOutcome: vi.fn(async () => null), recordPhaseMatchOutcome: vi.fn(async () => 'written'),
  deletePhaseMatchOutcome: vi.fn(async () => 1),
}));
vi.mock('@/lib/supabase/queries/phase-match-snapshots', () => ({ getPhaseMatchSnapshots: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getPhaseRoundById: vi.fn(async () => ({ round_number: 4 })) }));
vi.mock('../rating-streak-streams', () => ({
  createMixedRatingStorage: vi.fn(() => ports.ratings),
  getPhaseRatingHistoryByMatches: ports.phaseHistory,
  mixedStreakStorage: {},
}));
vi.mock('@/lib/rating/updateRatings', () => ({ updateRatingsWithStorage: vi.fn(async () => ({ status: 'skipped_test_season' })) }));
vi.mock('@/lib/gamification/streaks', () => ({ recomputeStreaksWithStorage: vi.fn(async () => null) }));
vi.mock('@/lib/gamification/signatures', () => ({ updateSignatures: vi.fn(async () => []) }));
vi.mock('../achievement-streams', () => ({ checkPhaseAchievements: vi.fn(async () => []) }));
vi.mock('../epb-storage', () => ({ createPhaseEpbStorage: vi.fn(() => ({})) }));
vi.mock('@/lib/match/evolution-match-evaluator', () => ({ createEpbKillEvaluator: vi.fn(() => ({ creditMatchRealKills: ports.kills })) }));
vi.mock('@/lib/match/epb-matchday', () => ({ createEpbMatchdayRunner: vi.fn(() => ports.matchday) }));
vi.mock('../game-pipeline-storage', () => ({ createNativeBracketPropagationStorage: vi.fn(() => ({})) }));
vi.mock('@/lib/tournament/bracket-propagation', () => ({ createBracketPropagation: vi.fn(() => ({ propagateBracketOnMatchComplete: ports.propagate })) }));

import { createPhaseMatchFinalizer } from '../finalization';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPhaseMatchById, markPhaseMatchFinalized } from '@/lib/supabase/queries/phase-matches';
import { recordPhaseMatchOutcome, deletePhaseMatchOutcome } from '@/lib/supabase/queries/phase-match-outcomes';
import { createMixedRatingStorage, mixedStreakStorage } from '../rating-streak-streams';
import { updateRatingsWithStorage } from '@/lib/rating/updateRatings';
import { recomputeStreaksWithStorage } from '@/lib/gamification/streaks';
import { checkPhaseAchievements } from '../achievement-streams';
import { createNativeBracketPropagationStorage } from '../game-pipeline-storage';

const phase: Phase = {
  id: 'phase', season_id: 'league', name: 'Fixture phase', description: '', bracket_type: 'single_elim',
  ruleset_id: 'rules', best_of_default: 3, bo_overrides: {}, is_doubles: false, team_visibility: 'hidden_until_match',
  status: 'active', current_round: 1, stage_order: 1, advancement_rule: null, enrollment_source: null,
  archived: false, legacy: false, bracket_reset_enabled: true, third_place_enabled: false,
  format_stage_key: null, format_group: 0, stage_spec: null, season_format_type: 'custom', created_at: '', updated_at: '',
};
const match: PhaseMatchWithPlayers = {
  id: 'match', phase_id: 'phase', round_id: 'round', player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1',
  status: 'completed', submitter_id: null, date_played: null, scheduled_at: null, auto_confirm_at: null,
  confirmed_at: 'completion', notes: '', social_image_url: null, bracket_side: null, bracket_pos: null,
  created_at: '', updated_at: '', player_1_name: 'Player One', player_2_name: 'Player Two',
  player_1_avatar_url: null, player_2_avatar_url: null, winner_name: 'Player One', round_status: 'active', games: [],
};
function effects(): PhaseFinalizationEffects {
  return { announcements: vi.fn(), formatHook: vi.fn(async () => undefined), revalidate: vi.fn(async () => undefined), releaseTeams: vi.fn(async () => 0) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPhaseById).mockResolvedValue(phase);
  vi.mocked(getPhaseMatchById).mockResolvedValue(match);
});
afterEach(() => {
  expect(ports.forbidden).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('native phase finalization adapter', () => {
  it('wires concrete phase ratings, streaks, achievements and bracket propagation without converting rows', async () => {
    const callbacks = effects();
    const finalizer = createPhaseMatchFinalizer(callbacks);
    expect(await finalizer.finalizeMatchCompletion({ match, winnerId: 'p1', previousStatus: 'pending_confirmation' }))
      .toEqual({ finalized: true, complete: true, failed_steps: [] });
    expect(createMixedRatingStorage).toHaveBeenCalledWith('phase');
    expect(updateRatingsWithStorage).toHaveBeenCalledWith('p1', 'p2', false, 'match', ports.ratings, { winnerId: 'p1', confirmedAt: 'completion' });
    expect(recomputeStreaksWithStorage).toHaveBeenCalledWith('p1', mixedStreakStorage);
    expect(checkPhaseAchievements).toHaveBeenCalledWith('p1', {
      match_id: 'match', phase_id: 'phase', season_id: 'league', winner_id: 'p1', loser_id: 'p2', is_draw: false,
    });
    expect(createNativeBracketPropagationStorage).toHaveBeenCalledWith(callbacks);
    expect(ports.propagate).toHaveBeenCalledWith(match, phase, []);
    expect(callbacks.formatHook).toHaveBeenCalledWith(match, 'p1', phase, 'completion');
    expect(callbacks.announcements).toHaveBeenCalledWith(expect.objectContaining({ match, competition: phase }));
    expect(callbacks.revalidate).toHaveBeenCalledWith('phase', 'match');
    expect(markPhaseMatchFinalized).toHaveBeenCalledWith('match', undefined, { confirmedAt: 'completion' });
  });

  it('routes staging and fenced discard exclusively to phase outcome queries', async () => {
    const finalizer = createPhaseMatchFinalizer(effects());
    await finalizer.stageAdminOutcome('match', { kind: 'forfeit', reason: 'Fixture', setBy: null });
    expect(recordPhaseMatchOutcome).toHaveBeenCalledWith(expect.objectContaining({ matchId: 'match', force: true, openOnly: true }));
    await finalizer.discardStagedAdminOutcome('match', { setAt: 'stage-token' });
    expect(deletePhaseMatchOutcome).toHaveBeenCalledWith('match', { onlyIfSetAt: 'stage-token' });
  });

  it('keeps the captured completion identity when later finalization work sees a replacement completion', async () => {
    vi.mocked(getPhaseById).mockImplementationOnce(async () => {
      vi.mocked(getPhaseMatchById).mockResolvedValue({ ...match, winner_id: 'p2', confirmed_at: 'new-completion' });
      return phase;
    });
    await createPhaseMatchFinalizer(effects()).finalizeMatchCompletion({ match, winnerId: 'p1', previousStatus: 'pending_confirmation' });
    expect(updateRatingsWithStorage).toHaveBeenCalledWith('p1', 'p2', false, 'match', ports.ratings, { winnerId: 'p1', confirmedAt: 'completion' });
  });

  it('passes a captured historical null token without fetching a newer token for ratings', async () => {
    vi.mocked(getPhaseMatchById).mockResolvedValue({ ...match, confirmed_at: null });
    await createPhaseMatchFinalizer(effects()).finalizeMatchCompletion({ match, winnerId: 'p1', previousStatus: 'pending_confirmation' });
    expect(updateRatingsWithStorage).toHaveBeenCalledWith('p1', 'p2', false, 'match', ports.ratings, { winnerId: 'p1', confirmedAt: null });
  });

  it('uses native EPB credits and matchday hooks with the actual phase match', async () => {
    vi.mocked(getPhaseById).mockResolvedValue({ ...phase, season_format_type: 'evolution_point_buy' });
    const finalizer = createPhaseMatchFinalizer(effects());
    const result = await finalizer.finalizeMatchCompletion({ match, winnerId: 'p1', previousStatus: 'in_progress' });
    expect(result.complete).toBe(true);
    expect(ports.kills).toHaveBeenCalledWith({ seasonId: 'league', matchday: 4, playerIds: ['p1', 'p2'], gameIds: [], statsByGame: {} });
    expect(ports.matchday).toHaveBeenCalledWith({ match, seasonId: 'league', matchday: 4, battleStats: [] });
  });

  it('classifies native worklists without accepting standalone history rows', async () => {
    const finalizer = createPhaseMatchFinalizer(effects());
    expect(await finalizer.findMatchesNeedingAdmin([match])).toEqual(new Map([['match', 'ratings_missing']]));
    expect(ports.phaseHistory).toHaveBeenCalledWith(['match']);
    expect(ports.ratings.getHistoryByMatches).not.toHaveBeenCalled();
    expect(ports.ratings.getHistoryByMatch).not.toHaveBeenCalled();
  });
});
