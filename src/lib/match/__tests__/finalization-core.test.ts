import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMatchFinalizer, type FinalizationMatch, type FinalizationCompetition, type MatchFinalizationStorage } from '../finalization-core';
import { StagedOutcomeBlockedError } from '../staged-outcome';
import type { StreakChanges } from '@/types/streak';

vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
import { logAuditEvent } from '@/lib/audit/log';

type OwnedMatch = FinalizationMatch & { phase_id: string };
const match: OwnedMatch = {
  id: 'match', phase_id: 'phase', round_id: 'round', player_1_id: 'p1', player_2_id: 'p2',
  winner_id: 'p1', status: 'completed', confirmed_at: 'completion-one',
  player_1_name: 'Player One', player_2_name: 'Player Two', games: [],
};
const competition: FinalizationCompetition = {
  id: 'phase', season_id: 'league', season_format_type: 'custom', bracket_type: 'single_elim',
};
const streaks: StreakChanges = {
  win_streak: { before: 0, after: 1 }, loss_streak: { before: 0, after: 0 },
  ko_streak: { before: 0, after: 0 }, flawless_streak: { before: 0, after: 0 }, new_records: [],
};

function fixture() {
  const calls: string[] = [];
  const storage = {
    competitionId: (row: OwnedMatch) => row.phase_id,
    auditOwner: (row: OwnedMatch) => ({ phase_id: row.phase_id }),
    resourceType: 'phase_match',
    getMatchById: vi.fn(async () => match),
    markMatchFinalized: vi.fn(async () => { calls.push('stamp'); return true; }),
    loadCompetition: vi.fn(async () => competition),
    getBattleStatsByMatch: vi.fn(async () => ({})),
    getMatchOutcome: vi.fn<MatchFinalizationStorage<OwnedMatch, FinalizationCompetition>['getMatchOutcome']>(async () => null),
    recordMatchOutcome: vi.fn<MatchFinalizationStorage<OwnedMatch, FinalizationCompetition>['recordMatchOutcome']>(async () => 'written'),
    deleteMatchOutcome: vi.fn(async () => 1),
    updateRatings: vi.fn<MatchFinalizationStorage<OwnedMatch, FinalizationCompetition>['updateRatings']>(async () => ({ status: 'skipped_test_season' })),
    recomputeStreaks: vi.fn(async () => streaks),
    updateSignatures: vi.fn(async () => []),
    checkAchievements: vi.fn(async () => []),
    emitAnnouncements: vi.fn(),
    isEpbCompetition: () => true,
    isElimCompetition: () => true,
    isKitCandidate: () => true,
    runEpbRealKillsStep: vi.fn(async () => { calls.push('kills'); return 1; }),
    runEpbStep: vi.fn(async () => { calls.push('epb'); }),
    getMatchSnapshots: vi.fn(async (): Promise<readonly unknown[]> => []),
    runBracketStep: vi.fn(async () => { calls.push('bracket'); }),
    runFormatHook: vi.fn(async () => { calls.push('hook'); }),
    revalidateMatchPages: vi.fn(async () => { calls.push('revalidate'); }),
    loadRatingScope: vi.fn(async () => ({ testSeasonTournamentIds: new Set<string>(), testSeasonPhaseIds: new Set<string>() })),
    matchCountsForRatings: vi.fn(() => true),
    getRatingHistoryByMatch: vi.fn<MatchFinalizationStorage<OwnedMatch, FinalizationCompetition>['getRatingHistoryByMatch']>(async () => []),
    getRatingHistoryByMatches: vi.fn<MatchFinalizationStorage<OwnedMatch, FinalizationCompetition>['getRatingHistoryByMatches']>(async () => []),
  } satisfies MatchFinalizationStorage<OwnedMatch, FinalizationCompetition>;
  return { storage, calls, finalizer: createMatchFinalizer<OwnedMatch, FinalizationCompetition>(storage) };
}

afterEach(() => vi.restoreAllMocks());

describe('owner-neutral finalization', () => {
  it('uses the actual owner and passes original rows through the shared steps', async () => {
    const { finalizer, storage, calls } = fixture();
    expect(await finalizer.finalizeMatchCompletion({ match, winnerId: 'p1', previousStatus: 'in_progress' }))
      .toEqual({ finalized: true, complete: true, failed_steps: [] });
    expect(storage.loadCompetition).toHaveBeenCalledWith('phase');
    expect(storage.checkAchievements).toHaveBeenCalledWith('p1', { match, competition, winnerId: 'p1', loserId: 'p2' });
    expect(storage.markMatchFinalized).toHaveBeenCalledWith('match', undefined, { confirmedAt: 'completion-one' });
    expect(storage.recordMatchOutcome).toHaveBeenCalledWith(expect.objectContaining({ kind: 'played', force: true }));
    expect(calls).toEqual(['kills', 'epb', 'bracket', 'hook', 'revalidate', 'stamp']);
  });

  it('rewrites the winning admin outcome even when battle stats fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { finalizer, storage } = fixture();
    storage.getBattleStatsByMatch.mockRejectedValue(new Error('stats unavailable'));
    const result = await finalizer.finalizeMatchCompletion({
      match, winnerId: 'p1', previousStatus: 'scheduled',
      adminOutcome: { kind: 'played', reason: 'Correction', setBy: 'admin' },
    });
    expect(result.complete).toBe(false);
    expect(storage.recordMatchOutcome).toHaveBeenCalledWith(expect.objectContaining({ kind: 'played', force: true, p1Faints: null }));
    expect(storage.runFormatHook).not.toHaveBeenCalled();
    expect(storage.markMatchFinalized).not.toHaveBeenCalled();
    expect(storage.revalidateMatchPages).toHaveBeenCalledWith('phase', 'match');
  });

  it('blocks the format hook behind failed bracket propagation and audits the phase owner', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { finalizer, storage } = fixture();
    storage.runBracketStep.mockRejectedValue(new Error('bracket failed'));
    const result = await finalizer.finalizeMatchCompletion({ match, winnerId: 'p1', previousStatus: 'in_progress' });
    expect(result.failed_steps).toEqual(['bracket_propagation', 'format_hook']);
    expect(storage.runFormatHook).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'phase_match', metadata: expect.objectContaining({ phase_id: 'phase' }),
    }));
  });

  it('rejects a different completed winner before side effects', async () => {
    const { finalizer, storage } = fixture();
    storage.getMatchById.mockResolvedValue({ ...match, winner_id: 'p2' });
    expect(await finalizer.finalizeMatchCompletion({ match, winnerId: 'p1', previousStatus: 'in_progress' }))
      .toEqual({ finalized: false, reason: 'match_changed', current_status: 'completed' });
    expect(storage.updateRatings).not.toHaveBeenCalled();
  });

  it('finalizes the verified native settlement without rewriting its outcome', async () => {
    const { finalizer, storage } = fixture();
    expect(await finalizer.finalizeMatchCompletion({
      match, winnerId: 'p1', previousStatus: 'scheduled', precommittedAdminOutcomeAt: 'completion-one',
    })).toEqual({ finalized: true, complete: true, failed_steps: [] });
    expect(storage.recordMatchOutcome).not.toHaveBeenCalled();
    expect(storage.runFormatHook).toHaveBeenCalledWith(match, 'p1', competition, 'completion-one');
    expect(storage.markMatchFinalized).toHaveBeenCalledWith('match', undefined, { confirmedAt: 'completion-one' });
  });

  it('will not adopt a newer native settlement with the same winner', async () => {
    const { finalizer, storage } = fixture();
    storage.getMatchById.mockResolvedValue({ ...match, confirmed_at: 'completion-two' });
    expect(await finalizer.finalizeMatchCompletion({
      match, winnerId: 'p1', previousStatus: 'scheduled', precommittedAdminOutcomeAt: 'completion-one',
    })).toEqual({ finalized: false, reason: 'match_changed', current_status: 'completed' });
    expect(storage.recordMatchOutcome).not.toHaveBeenCalled();
    expect(storage.loadCompetition).not.toHaveBeenCalled();
  });

  it('keeps an unverified committed settlement for recovery without running any further effects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { finalizer, storage } = fixture();
    storage.getMatchById.mockRejectedValue(new Error('Completion read unavailable'));
    expect(await finalizer.finalizeMatchCompletion({
      match, winnerId: 'p1', previousStatus: 'scheduled', precommittedAdminOutcomeAt: 'completion-one',
    })).toEqual({ finalized: true, complete: false, failed_steps: ['mark_finalized'] });
    expect(storage.loadCompetition).not.toHaveBeenCalled();
    expect(storage.recordMatchOutcome).not.toHaveBeenCalled();
  });

  it('heals only verified ratings, skips existing snapshots and never repeats announcements or achievements', async () => {
    const { finalizer, storage, calls } = fixture();
    storage.matchCountsForRatings.mockReturnValue(false);
    storage.getMatchSnapshots.mockResolvedValue([{}]);
    expect(await finalizer.healMatchFinalization(match)).toEqual({ healed: true, failed_steps: [] });
    expect(storage.updateRatings).not.toHaveBeenCalled();
    expect(storage.checkAchievements).not.toHaveBeenCalled();
    expect(storage.emitAnnouncements).not.toHaveBeenCalled();
    expect(storage.runEpbStep).not.toHaveBeenCalled();
    expect(calls).toEqual(['kills', 'bracket', 'hook', 'revalidate', 'stamp']);
  });

  it('stops a heal with missing ratings before any dependent write', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { finalizer, storage } = fixture();
    expect(await finalizer.healMatchFinalization(match)).toEqual({
      healed: false, needs_admin: true, reason: 'ratings_missing', failed_steps: ['ratings'],
    });
    expect(storage.loadCompetition).not.toHaveBeenCalled();
    expect(storage.recomputeStreaks).not.toHaveBeenCalled();
  });

  it('skips a stale completion token before verifying ratings', async () => {
    const { finalizer, storage } = fixture();
    storage.getMatchById.mockResolvedValue({ ...match, confirmed_at: 'completion-two' });
    expect(await finalizer.healMatchFinalization(match)).toEqual({ healed: false, skipped: true, reason: 'not_completed', failed_steps: [] });
    expect(storage.getRatingHistoryByMatch).not.toHaveBeenCalled();
  });

  it('classifies a worklist with one batched history read and no per-match reads', async () => {
    const { finalizer, storage } = fixture();
    expect(await finalizer.findMatchesNeedingAdmin([match, { ...match, id: 'invalid', winner_id: null }]))
      .toEqual(new Map([['invalid', 'winner_not_participant'], ['match', 'ratings_missing']]));
    expect(storage.getRatingHistoryByMatches).toHaveBeenCalledExactlyOnceWith(['match']);
    expect(storage.getRatingHistoryByMatch).not.toHaveBeenCalled();
  });

  it('refuses staging an unresolved dispute and restores it after a lost staging race', async () => {
    const { finalizer, storage } = fixture();
    storage.getMatchOutcome.mockResolvedValue({ match_id: 'match', kind: 'unresolved', source: 'replay', reason: 'replay_engine_tie', p1_faints: null, p2_faints: null, set_by: null, set_at: 'mark' });
    storage.getMatchById.mockResolvedValue({ ...match, status: 'disputed' });
    await expect(finalizer.stageAdminOutcome('match', { kind: 'forfeit', reason: 'Fixture', setBy: null }))
      .rejects.toBeInstanceOf(StagedOutcomeBlockedError);
    expect(storage.recordMatchOutcome).not.toHaveBeenCalled();
    await finalizer.discardStagedAdminOutcome('match', { setAt: 'staged-mark' });
    expect(storage.deleteMatchOutcome).toHaveBeenCalledWith('match', { onlyIfSetAt: 'staged-mark' });
    expect(storage.recordMatchOutcome).toHaveBeenCalledWith(expect.objectContaining({ kind: 'unresolved', force: false }));
  });
});
