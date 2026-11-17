import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhaseMatchServiceEffects } from '../match-services';
import type { Phase } from '@/types/league-phase';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';

const ports = vi.hoisted(() => ({
  forbidden: vi.fn(() => { throw new Error('Unexpected database access in service assembly'); }),
  pipeline: { recordGameResult: vi.fn() },
  finalizer: {
    finalizeMatchCompletion: vi.fn(), healMatchFinalization: vi.fn(), stageAdminOutcome: vi.fn(),
    discardStagedAdminOutcome: vi.fn(), findMatchesNeedingAdmin: vi.fn(),
  },
  repair: vi.fn(async () => ({})),
  recheck: vi.fn(async () => ({ events: [], failed: false })),
  kit: {
    completed: vi.fn(async () => true), reverted: vi.fn(async () => true), unresolved: vi.fn(async () => undefined),
    stageEndedWarning: vi.fn(async () => null),
  },
}));

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: ports.forbidden, rpc: ports.forbidden } }));
vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: ports.forbidden }));
vi.mock('../game-pipeline-storage', () => ({ createNativeGamePipeline: vi.fn(() => ports.pipeline) }));
vi.mock('../finalization', () => ({ createPhaseMatchFinalizer: vi.fn(() => ports.finalizer) }));
vi.mock('../reopen', () => ({
  createNativeMatchReopener: vi.fn(() => vi.fn()),
  createNativeOutcomeTakeback: () => ({ readOutcomeMark: vi.fn(), takeBackMarkedOutcome: vi.fn() }),
}));
vi.mock('../epb-game-edit', () => ({ createNativeEpbGameEditRechecker: () => ports.recheck }));
vi.mock('../kit-match-effects', () => ({ createNativeKitMatchEffects: vi.fn(() => ports.kit) }));
vi.mock('@/lib/reconcile/evolution-rebuild', () => ({ createEpbEvolutionRebuilder: () => ({ repairSeasonEvolution: ports.repair }) }));
vi.mock('../epb-storage', () => ({ createMixedEpbRebuildStorage: () => ({}) }));
vi.mock('../phase-aggregate-storage', () => ({
  enqueuePhaseAggregateJob: vi.fn(async () => undefined), cancelPhaseAggregateJobsForGame: vi.fn(async () => 0),
  applyPhaseGameAggregatesNow: vi.fn(async () => undefined), rollbackPhaseGameAggregates: vi.fn(async () => 'rolled_back'),
}));

import { createPhaseMatchServices } from '../match-services';
import { createNativeGamePipeline } from '../game-pipeline-storage';
import { createPhaseMatchFinalizer } from '../finalization';
import { enqueuePhaseAggregateJob } from '../phase-aggregate-storage';

const phase: Phase = {
  id: 'phase', season_id: 'league', name: 'Fixture phase', description: '', bracket_type: 'round_robin',
  ruleset_id: 'rules', best_of_default: 3, bo_overrides: {}, is_doubles: false, team_visibility: 'hidden_until_match',
  status: 'active', current_round: 1, stage_order: 1, advancement_rule: null, enrollment_source: null,
  archived: false, legacy: false, bracket_reset_enabled: true, third_place_enabled: false,
  format_stage_key: null, format_group: 0, stage_spec: null, season_format_type: 'custom', created_at: '', updated_at: '',
};
const match: PhaseMatchWithPlayers = {
  id: 'match', phase_id: 'phase', round_id: 'round', player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1',
  status: 'completed', submitter_id: null, date_played: null, scheduled_at: null, auto_confirm_at: null,
  confirmed_at: 'completion', notes: '', social_image_url: null, bracket_side: null, bracket_pos: null,
  created_at: '', updated_at: '', player_1_name: 'Trainer One', player_2_name: 'Trainer Two',
  player_1_avatar_url: null, player_2_avatar_url: null, winner_name: 'Trainer One', round_status: 'active', games: [],
};

function effects(): PhaseMatchServiceEffects {
  return {
    announcements: vi.fn(), revalidate: vi.fn(), releaseTeams: vi.fn(async () => 0),
    canAdminister: vi.fn(async () => false), announceDispute: vi.fn(async () => undefined),
    kit: {
      enroll: vi.fn(async () => ({ enrolled_count: 0 })), auditMatchTeams: vi.fn(async () => undefined),
      stageCompleted: vi.fn(async () => undefined), invalidate: vi.fn(),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('native match service assembly', () => {
  it('constructs explicit native entry points without reading either store', () => {
    const services = createPhaseMatchServices(effects());
    expect(services.recordGameResult).toBe(ports.pipeline.recordGameResult);
    expect(services.finalizeMatchCompletion).toBe(ports.finalizer.finalizeMatchCompletion);
    expect(typeof services.decide).toBe('function');
    expect(typeof services.autoConfirm).toBe('function');
    expect(ports.forbidden).not.toHaveBeenCalled();
  });

  it('binds concrete EPB editing and mixed repair instead of external P3 callbacks', async () => {
    createPhaseMatchServices(effects());
    const bound = vi.mocked(createNativeGamePipeline).mock.calls[0][0];
    expect(bound.recheckEpbAfterEdit).toBe(ports.recheck);
    await bound.repairSeasonEvolution('league');
    expect(ports.repair).toHaveBeenCalledWith('league');
  });

  it('refuses a tournament aggregate owner before any native write', async () => {
    createPhaseMatchServices(effects());
    const bound = vi.mocked(createNativeGamePipeline).mock.calls[0][1];
    expect(() => bound.enqueueAggregateJob('game', { kind: 'tournament', tournament_id: 'cup', season_id: null })).toThrow();
    expect(enqueuePhaseAggregateJob).not.toHaveBeenCalled();
    await bound.enqueueAggregateJob('game', { kind: 'phase', phase_id: 'phase', season_id: 'league' });
    expect(enqueuePhaseAggregateJob).toHaveBeenCalledWith('game', { kind: 'phase', phase_id: 'phase', season_id: 'league' });
  });

  it('preserves a historical null token and does not ignore a refused native format event', async () => {
    createPhaseMatchServices(effects());
    const bound = vi.mocked(createPhaseMatchFinalizer).mock.calls[0][0];
    await bound.formatHook(match, 'p1', phase, null);
    expect(ports.kit.completed).toHaveBeenCalledWith(expect.objectContaining({ confirmedAt: null }));
    ports.kit.completed.mockResolvedValueOnce(false);
    await expect(bound.formatHook(match, 'p1', phase, 'completion')).rejects.toThrow('did not apply');
    expect(ports.kit.completed).toHaveBeenCalledWith({
      phase, matchId: 'match', roundId: 'round', player1Id: 'p1', player2Id: 'p2', winnerId: 'p1', confirmedAt: 'completion',
    });
  });
});
