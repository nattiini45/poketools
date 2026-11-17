import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: vi.fn(), getPhaseParticipants: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({
  getPhaseMatchById: vi.fn(), transitionPhaseMatchStatus: vi.fn(), clearPhaseMatchSocialImage: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/phase-match-outcomes', () => ({ getPhaseMatchOutcome: vi.fn(), deletePhaseMatchOutcome: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-match-children', () => ({ deletePhaseMatchAnalyses: vi.fn(), deletePhaseMatchPrepAnalyses: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-match-snapshots', () => ({ deletePhaseMatchSnapshots: vi.fn() }));
vi.mock('@/lib/supabase/queries/match-outcomes', () => ({ getMatchOutcome: vi.fn(), deleteMatchOutcome: vi.fn() }));
vi.mock('@/lib/league-phase/game-pipeline-storage', () => ({ createNativeBracketPropagationStorage: vi.fn((effects) => effects) }));
const bracket = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tournament/bracket-propagation', () => ({ createBracketPropagation: () => ({ unpropagateBracketOnMatchReset: bracket }) }));

import { createNativeMatchReopener, createNativeOutcomeTakeback, type NativeMatchReopenEffects } from '../reopen';
import { getPhaseById, getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import { getPhaseMatchById, transitionPhaseMatchStatus, clearPhaseMatchSocialImage } from '@/lib/supabase/queries/phase-matches';
import { getPhaseMatchOutcome, deletePhaseMatchOutcome } from '@/lib/supabase/queries/phase-match-outcomes';
import { deletePhaseMatchAnalyses, deletePhaseMatchPrepAnalyses } from '@/lib/supabase/queries/phase-match-children';
import { deletePhaseMatchSnapshots } from '@/lib/supabase/queries/phase-match-snapshots';
import { getMatchOutcome, deleteMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { MatchReopenDownstreamPlayedError, MatchStateChangedError } from '@/lib/match/state-errors';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';

const match = {
  id: 'native-match', phase_id: 'phase', round_id: 'round', status: 'completed',
  player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1',
  games: [{ id: 'retained-game' }],
} as PhaseMatchWithPlayers;
const phase = { id: 'phase', season_id: 'league', season_format_type: 'round_robin', bracket_type: 'single_elim' };

function effects(): NativeMatchReopenEffects {
  return {
    pipeline: {
      preflightUncompleteRebuild: vi.fn(async () => {}),
      collectPlayedDownstreamMatches: vi.fn(async () => []),
      rebuildGamificationAfterUncomplete: vi.fn(async () => ['p1', 'p2']),
      recheckEvolutions: vi.fn(async () => ({ events: [], failed: false })),
      revertRoundIfCompleted: vi.fn(async () => {}),
    },
    releaseTeams: vi.fn(async () => 0),
    revertFormatCompletion: vi.fn(async () => true),
    repairSeasonEvolution: vi.fn(async () => ({})),
    loadStageEndedWarning: vi.fn(async () => null),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPhaseMatchById).mockResolvedValue(match);
  vi.mocked(getPhaseById).mockResolvedValue(phase as never);
  vi.mocked(getPhaseParticipants).mockResolvedValue([]);
  vi.mocked(transitionPhaseMatchStatus).mockResolvedValue({ ...match, status: 'in_progress' });
  vi.mocked(getPhaseMatchOutcome).mockResolvedValue({ set_at: 'before' } as never);
  vi.mocked(deletePhaseMatchOutcome).mockResolvedValue(1);
  vi.mocked(deletePhaseMatchSnapshots).mockResolvedValue(undefined);
  bracket.mockResolvedValue(['removed']);
});

describe('native reopen using the shared orchestration', () => {
  it('uses the real phase identity, preserves games and fences the admin CAS and outcome delete', async () => {
    const port = effects();
    const order: string[] = [];
    vi.mocked(port.pipeline.preflightUncompleteRebuild).mockImplementation(async () => { order.push('ratings'); });
    vi.mocked(port.pipeline.collectPlayedDownstreamMatches).mockImplementation(async () => { order.push('downstream'); return []; });
    vi.mocked(getPhaseMatchOutcome).mockImplementation(async () => { order.push('read'); return { set_at: 'before' } as never; });
    vi.mocked(transitionPhaseMatchStatus).mockImplementation(async () => { order.push('cas'); return match; });
    vi.mocked(deletePhaseMatchOutcome).mockImplementation(async () => { order.push('delete'); return 0; });
    const before = structuredClone(match);
    const result = await createNativeMatchReopener(port)(match.id, 'admin');
    expect(order).toEqual(['ratings', 'downstream', 'read', 'cas', 'delete']);
    expect(getPhaseById).toHaveBeenCalledWith('phase');
    expect(transitionPhaseMatchStatus).toHaveBeenCalledWith(match.id, {
      expectedStatus: 'completed', status: 'in_progress', winnerId: null,
    }, 'admin');
    expect(deletePhaseMatchOutcome).toHaveBeenCalledWith(match.id, { onlyIfSetAt: 'before' });
    expect(bracket).toHaveBeenCalledWith(match, phase, []);
    expect(result).toEqual({ from_status: 'completed', ratings_rebuilt_players: 2, bracket_matches_removed: 1, failed_steps: [] });
    expect(deletePhaseMatchAnalyses).toHaveBeenCalledWith(match.id);
    expect(deletePhaseMatchPrepAnalyses).toHaveBeenCalledWith(match.id);
    expect(clearPhaseMatchSocialImage).toHaveBeenCalledWith(match.id);
    expect(match).toEqual(before);
    expect(match).not.toHaveProperty('tournament_id');
    expect(getMatchOutcome).not.toHaveBeenCalled();
    expect(deleteMatchOutcome).not.toHaveBeenCalled();
  });

  it.each(['pending_confirmation', 'disputed'] as const)('does not rebuild an unfinalized %s match', async (status) => {
    vi.mocked(getPhaseMatchById).mockResolvedValue({ ...match, status });
    const port = effects();
    await createNativeMatchReopener(port)(match.id, 'admin');
    expect(port.pipeline.preflightUncompleteRebuild).not.toHaveBeenCalled();
    expect(port.pipeline.rebuildGamificationAfterUncomplete).not.toHaveBeenCalled();
    expect(deletePhaseMatchAnalyses).not.toHaveBeenCalled();
    expect(port.revertFormatCompletion).toHaveBeenCalledTimes(status === 'disputed' ? 1 : 0);
    expect(deletePhaseMatchOutcome).toHaveBeenCalledWith(match.id, { onlyIfSetAt: 'before' });
  });

  it('refuses played downstream matches and invalid rating history before any write', async () => {
    const port = effects();
    vi.mocked(port.pipeline.collectPlayedDownstreamMatches).mockResolvedValue([match]);
    await expect(createNativeMatchReopener(port)(match.id, 'admin')).rejects.toBeInstanceOf(MatchReopenDownstreamPlayedError);
    vi.mocked(port.pipeline.preflightUncompleteRebuild).mockRejectedValue(new Error('rating history gap'));
    await expect(createNativeMatchReopener(port)(match.id, 'admin')).rejects.toThrow('rating history gap');
    expect(transitionPhaseMatchStatus).not.toHaveBeenCalled();
    expect(deletePhaseMatchOutcome).not.toHaveBeenCalled();
  });

  it('keeps the outcome and runs no postwrite effects on a CAS miss', async () => {
    vi.mocked(transitionPhaseMatchStatus).mockResolvedValue(null);
    const port = effects();
    await expect(createNativeMatchReopener(port)(match.id, 'admin')).rejects.toBeInstanceOf(MatchStateChangedError);
    expect(deletePhaseMatchOutcome).not.toHaveBeenCalled();
    expect(port.revertFormatCompletion).not.toHaveBeenCalled();
    expect(bracket).not.toHaveBeenCalled();
  });

  it('fails closed when reading the outcome mark fails', async () => {
    vi.mocked(getPhaseMatchOutcome).mockRejectedValueOnce(new Error('outcome read'));
    await expect(createNativeMatchReopener(effects())(match.id, 'admin')).rejects.toThrow('outcome read');
    expect(transitionPhaseMatchStatus).not.toHaveBeenCalled();
    expect(deletePhaseMatchOutcome).not.toHaveBeenCalled();
  });

  it.each(['scheduled', 'in_progress'] as const)('refuses %s without writing', async (status) => {
    vi.mocked(getPhaseMatchById).mockResolvedValue({ ...match, status });
    await expect(createNativeMatchReopener(effects())(match.id, 'admin')).rejects.toMatchObject({ code: 'match_transition_invalid' });
    expect(transitionPhaseMatchStatus).not.toHaveBeenCalled();
  });

  it('uses the injected mixed EPB repair once rather than the legacy evolution recheck', async () => {
    vi.mocked(getPhaseById).mockResolvedValue({ ...phase, season_format_type: 'evolution_point_buy' } as never);
    const port = effects();
    await createNativeMatchReopener(port)(match.id, 'admin');
    expect(port.repairSeasonEvolution).toHaveBeenCalledExactlyOnceWith('league');
    expect(port.pipeline.recheckEvolutions).not.toHaveBeenCalled();
  });

  it('records postwrite failures separately and continues all subsequent steps', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = effects();
    vi.mocked(deletePhaseMatchOutcome).mockRejectedValueOnce(new Error('outcome'));
    vi.mocked(port.revertFormatCompletion).mockResolvedValue(false);
    vi.mocked(port.pipeline.revertRoundIfCompleted).mockRejectedValue(new Error('round'));
    bracket.mockRejectedValueOnce(new Error('bracket'));
    vi.mocked(deletePhaseMatchSnapshots).mockRejectedValueOnce(new Error('cleanup'));
    vi.mocked(port.pipeline.rebuildGamificationAfterUncomplete).mockRejectedValue(new Error('ratings'));
    vi.mocked(port.pipeline.recheckEvolutions).mockResolvedValue({ events: [], failed: true });
    const result = await createNativeMatchReopener(port)(match.id, 'admin');
    expect(result.failed_steps).toEqual(['outcome', 'format', 'round', 'bracket', 'cleanup', 'ratings', 'evolution']);
    expect(port.loadStageEndedWarning).toHaveBeenCalledWith(phase, true);
    expect(spy).toHaveBeenCalledTimes(7);
    spy.mockRestore();
  });

  it('exposes the native outcome takeback port independently of pipeline assembly', async () => {
    const outcome = createNativeOutcomeTakeback();
    expect(await outcome.readOutcomeMark(match.id)).toBe('before');
    expect(await outcome.takeBackMarkedOutcome(match.id, 'before')).toBe(true);
    expect(deletePhaseMatchOutcome).toHaveBeenCalledWith(match.id, { onlyIfSetAt: 'before' });
  });
});
