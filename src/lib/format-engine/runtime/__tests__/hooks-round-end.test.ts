import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYERS, SEED, giftDef, stateFor } from './helpers';

vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  loadFreshKitContext: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/fire', () => ({ fireEvent: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/checks-server', () => ({ openChecks: vi.fn(), resolveCheck: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/team-audit-server', () => ({ auditMatchTeams: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-table', () => ({ loadStageTable: vi.fn(), playerRowsOf: vi.fn(() => ({})) }));
vi.mock('@/lib/supabase/queries/match-outcomes', () => ({ getMatchOutcome: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: vi.fn(), getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchesByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-end-server', () => ({ checkStageEnd: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/phase-complete', () => ({ completePhaseAtStageEnd: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));

import { checkStageEnd } from '../stage-end-server';
import { completePhaseAtStageEnd } from '../phase-complete';
import { fireEvent } from '../fire';
import { loadFreshKitContext, type KitContext } from '../load';
import { getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { getRoundById, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { logger } from '@/lib/logger';
import { FormatRuntimeError } from '@/lib/supabase/queries/format-runtime';
import { onRoundCompleted } from '../hooks';
import { isStaleOnly, newHookReport } from '../stale';

const def = giftDef();
const stage = def.stages[0];
const TOURNAMENT = { id: 't-1', season_id: 's-1', season_format_type: 'custom' as const };
const input = { tournament: TOURNAMENT, roundId: 'r-2' };
const facts = { round: 2, rounds_played: 2, open_matches: 0, participants: 6 };
const settled = ['match_completed:m-1', 'match_completed:m-2'];

function context(over: Partial<KitContext> = {}, fired: string[] = []): KitContext {
  return {
    seasonId: 's-1',
    seed: SEED,
    revision: 1,
    def,
    state: stateFor(def, { firedEventKeys: fired }),
    tunableIssues: [],
    phases: [{ id: 't-1', stage, members: PLAYERS }],
    ...over,
  };
}

const withEnd = (fired: string[] = []) =>
  context({ phases: [{ id: 't-1', stage: { ...stage, end_when: { kind: 'rounds', rounds: 2 } }, members: PLAYERS }] }, fired);

const round = (over: Record<string, unknown> = {}) => ({ id: 'r-2', tournament_id: 't-1', round_number: 2, status: 'completed', ...over });
const match = (id: string, over: Record<string, unknown> = {}) => ({ id, round_id: 'r-2', status: 'completed', winner_id: 'p1', ...over });
const fired = { eventKey: 'x', fired: true, ops: [], notifications: [], issues: [], cascaded: [] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadFreshKitContext).mockResolvedValue(context({}, settled));
  vi.mocked(fireEvent).mockResolvedValue(fired as never);
  vi.mocked(getRoundById).mockResolvedValue(round() as never);
  vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
  vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1'), match('m-2')] as never);
  vi.mocked(completePhaseAtStageEnd).mockResolvedValue('completed');
});

describe('onRoundCompleted', () => {
  it('does nothing outside a custom league or a kit league', async () => {
    await expect(onRoundCompleted({ ...input, tournament: { ...TOURNAMENT, season_format_type: null } })).resolves.toBe(true);
    expect(loadFreshKitContext).not.toHaveBeenCalled();
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await expect(onRoundCompleted(input)).resolves.toBe(true);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('fires round_end for the stage and the round number, with the context it loaded', async () => {
    const ctx = context({}, settled);
    vi.mocked(loadFreshKitContext).mockResolvedValue(ctx);
    await expect(onRoundCompleted(input)).resolves.toBe(true);
    expect(fireEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fireEvent).mock.calls[0]).toEqual(['s-1', { event: 'round_end', stage: 'main', round: 2 }, null, { context: ctx }]);
  });

  it('fires nothing for a round that was reopened (or deleted) after the completion, and evaluates no stage end', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd(settled));
    vi.mocked(getRoundById).mockResolvedValue(round({ status: 'pending' }) as never);
    await expect(onRoundCompleted(input)).resolves.toBe(true);
    vi.mocked(getRoundById).mockResolvedValue(null);
    await expect(onRoundCompleted(input)).resolves.toBe(true);
    vi.mocked(getRoundById).mockResolvedValue(round({ tournament_id: 't-other' }) as never);
    await expect(onRoundCompleted(input)).resolves.toBe(true);
    expect(fireEvent).not.toHaveBeenCalled();
    expect(checkStageEnd).not.toHaveBeenCalled();
  });

  it('logs the effects the event skipped', async () => {
    vi.mocked(fireEvent).mockResolvedValue({ ...fired, issues: [{ code: 'x', rule: 'bonus' }] } as never);
    await onRoundCompleted(input);
    expect(logger.warn).toHaveBeenCalledWith('format-engine/hooks', 'event effect skipped', expect.objectContaining({ roundId: 'r-2', code: 'x' }));
  });

  describe('the effects of the round matches come first', () => {
    it('defers while a completed match has not fired match_completed: no event, no stage end, false and no failure in the report', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd(['match_completed:m-1']));
      const report = newHookReport();
      await expect(onRoundCompleted({ ...input, report })).resolves.toBe(false);
      expect(fireEvent).not.toHaveBeenCalled();
      expect(checkStageEnd).not.toHaveBeenCalled();
      expect(report).toEqual({ stale: false, failed: false });
    });

    it('does not wait for an unplayed match of a force-completed round, nor for a match without a winner', async () => {
      vi.mocked(getMatchesByTournament).mockResolvedValue([
        match('m-1'),
        match('m-2', { status: 'scheduled', winner_id: null }),
        match('m-3', { winner_id: null }),
        match('m-4', { round_id: 'r-1', status: 'completed' }),
      ] as never);
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({}, ['match_completed:m-1']));
      await expect(onRoundCompleted(input)).resolves.toBe(true);
      expect(fireEvent).toHaveBeenCalledTimes(1);
    });

    it('follows the generation of a match that was reverted and completed again', async () => {
      vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1')] as never);
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({}, ['match_completed:m-1', 'match_reverted:m-1:1']));
      await expect(onRoundCompleted(input)).resolves.toBe(false);
      expect(fireEvent).not.toHaveBeenCalled();
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({}, ['match_completed:m-1', 'match_reverted:m-1:1', 'match_completed:m-1:1']));
      await expect(onRoundCompleted(input)).resolves.toBe(true);
      expect(fireEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('failures', () => {
    it('never throws into the caller: logs the original error, reports the failure, and evaluates no stage end', async () => {
      const boom = new Error('db down');
      vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd(settled));
      vi.mocked(fireEvent).mockRejectedValue(boom);
      const report = newHookReport();
      await expect(onRoundCompleted({ ...input, report })).resolves.toBe(false);
      expect(logger.error).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('round completed'), expect.objectContaining({ error: boom, roundId: 'r-2' }));
      expect(report.failed).toBe(true);
      expect(checkStageEnd).not.toHaveBeenCalled();
    });

    it('tells a stale format from a failure: a warning, nothing used up, so the cron sweep fires it against the current format', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd(settled));
      vi.mocked(fireEvent).mockRejectedValue(new FormatRuntimeError('format_context_stale'));
      const report = newHookReport();
      await expect(onRoundCompleted({ ...input, report })).resolves.toBe(false);
      expect(isStaleOnly(report)).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
      expect(checkStageEnd).not.toHaveBeenCalled();
    });

    it('is repeatable: the second call after a failed one fires the event and then the stage end', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd(settled));
      vi.mocked(checkStageEnd).mockResolvedValue({ met: true, facts, openInRound: 0, unfinishedMatchIds: [] });
      vi.mocked(fireEvent).mockRejectedValueOnce(new Error('db down'));
      await expect(onRoundCompleted(input)).resolves.toBe(false);
      await expect(onRoundCompleted(input)).resolves.toBe(true);
      expect(fireEvent).toHaveBeenCalledTimes(2);
      expect(completePhaseAtStageEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('end_when', () => {
    it('costs nothing for a stage without end_when', async () => {
      await onRoundCompleted(input);
      expect(checkStageEnd).not.toHaveBeenCalled();
      expect(completePhaseAtStageEnd).not.toHaveBeenCalled();
    });

    it('evaluates the stage end after the event and names the completed round, so its leftovers are settled', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd(settled));
      vi.mocked(checkStageEnd).mockResolvedValue({ met: true, facts, openInRound: 0, unfinishedMatchIds: ['m-9'] });
      const order: string[] = [];
      vi.mocked(fireEvent).mockImplementation(async () => {
        order.push('round_end');
        return fired as never;
      });
      vi.mocked(completePhaseAtStageEnd).mockImplementation(async () => {
        order.push('phase');
        return 'completed';
      });
      await expect(onRoundCompleted(input)).resolves.toBe(true);
      expect(order).toEqual(['round_end', 'phase']);
      expect(vi.mocked(checkStageEnd).mock.calls[0][2]).toBe('r-2');
      // The unfinished matches the read saw are handed over, so a challenge accepted since still keeps the phase open.
      expect(completePhaseAtStageEnd).toHaveBeenCalledWith('t-1', 'end_when:main', ['m-9']);
    });

    it('keeps the phase running while the condition is unmet or a match is open', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd(settled));
      vi.mocked(checkStageEnd).mockResolvedValue({ met: false, facts, openInRound: 0, unfinishedMatchIds: [] });
      await onRoundCompleted(input);
      vi.mocked(checkStageEnd).mockResolvedValue({ met: true, facts, openInRound: 1, unfinishedMatchIds: [] });
      await onRoundCompleted(input);
      expect(completePhaseAtStageEnd).not.toHaveBeenCalled();
    });

    it('reports a stage end that failed after the event fired, and logs what to do (the event key is used up)', async () => {
      const boom = new Error('db down');
      vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd(settled));
      vi.mocked(checkStageEnd).mockResolvedValue({ met: true, facts, openInRound: 0, unfinishedMatchIds: [] });
      vi.mocked(completePhaseAtStageEnd).mockRejectedValue(boom);
      const report = newHookReport();
      await expect(onRoundCompleted({ ...input, report })).resolves.toBe(false);
      expect(report.failed).toBe(true);
      expect(fireEvent).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('stage end after a completed round'), expect.objectContaining({ roundId: 'r-2' }));
    });
  });

  describe('a stage that repeats per group', () => {
    const groupStage = { ...stage, foreach_group: { from: 'g' } };
    const first = { id: 't-1', stage: groupStage, members: PLAYERS };
    const second = { id: 't-2', stage: groupStage, members: PLAYERS };
    const grouped = (firedKeys: string[] = settled) => context({ phases: [first, second] }, firedKeys);

    it('waits for the round of the other group: nothing fires until the last group completes its round', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(grouped());
      vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r-b', round_number: 2, status: 'active' }] as never);
      await expect(onRoundCompleted(input)).resolves.toBe(true);
      expect(fireEvent).not.toHaveBeenCalled();
    });

    it('fires once every group completed that round, after the match_completed of the other group exists', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(grouped());
      vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r-b', round_number: 2, status: 'completed' }] as never);
      vi.mocked(getMatchesByTournament).mockImplementation(
        async (phaseId: string) => (phaseId === 't-1' ? [match('m-1'), match('m-2')] : [match('m-5', { round_id: 'r-b' })]) as never,
      );
      await expect(onRoundCompleted(input)).resolves.toBe(false);
      expect(fireEvent).not.toHaveBeenCalled();
      vi.mocked(loadFreshKitContext).mockResolvedValue(grouped([...settled, 'match_completed:m-5']));
      await expect(onRoundCompleted(input)).resolves.toBe(true);
      expect(fireEvent).toHaveBeenCalledTimes(1);
    });

    it('does not wait for a group that has no round of that number', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(grouped());
      vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r-b', round_number: 1, status: 'active' }] as never);
      await onRoundCompleted(input);
      expect(fireEvent).toHaveBeenCalledTimes(1);
    });

    it('still evaluates its own phase end_when while it waits for the other group', async () => {
      const ended = { ...first, stage: { ...groupStage, end_when: { kind: 'rounds' as const, rounds: 2 } } };
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({ phases: [ended, second] }, settled));
      vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r-b', round_number: 2, status: 'active' }] as never);
      vi.mocked(checkStageEnd).mockResolvedValue({ met: true, facts, openInRound: 0, unfinishedMatchIds: [] });
      await onRoundCompleted(input);
      expect(fireEvent).not.toHaveBeenCalled();
      expect(completePhaseAtStageEnd).toHaveBeenCalledWith('t-1', 'end_when:main', []);
    });
  });
});
