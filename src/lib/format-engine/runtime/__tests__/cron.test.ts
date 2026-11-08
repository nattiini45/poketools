import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeadlinePolicy, StageCalendar } from '@/lib/format-kit/types';
import { PLAYERS, SEED, link, stateFor, wichtelDef } from './helpers';

vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  loadFreshKitContext: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/fire', () => ({ fireEvent: vi.fn(), fireLockedActionEvents: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/actions-server', () => ({ submitAction: vi.fn() }));
vi.mock('@/lib/format-engine/challenge-server', () => ({ expireChallenges: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-cron', () => ({
  listKitCronPhases: vi.fn(),
  listKitSeasonIds: vi.fn(),
  listKitIdleSeasonIds: vi.fn(),
  listFinalizedMatches: vi.fn(),
  listUncompletedMatches: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onMatchCompleted: vi.fn(), onRoundCompleted: vi.fn(), revertMatchCompletion: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getSeasonKitHead: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/format-runtime')>()),
  openFormatCheck: vi.fn(),
  completeFormatForfeit: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: vi.fn(), getMatchesByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn(), listRoundStatusesByTournamentIds: vi.fn() }));
vi.mock('@/lib/supabase/queries/teams', () => ({ listTeamsByTournament: vi.fn() }));
vi.mock('@/lib/match/finalize', () => ({ finalizeMatchCompletion: vi.fn(), stageAdminOutcome: vi.fn(), discardStagedAdminOutcome: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn(), revalidateMatchPages: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { expireChallenges } from '../../challenge-server';
import { submitAction } from '../actions-server';
import {
  cronOrderOffset,
  cronWindowStart,
  currentlyCompletedMatchIds,
  FORMAT_CRON_BACKFILL_LIMIT,
  FORMAT_CRON_BACKFILL_PER_LEAGUE,
  FORMAT_CRON_IDLE_LEAGUE_LIMIT,
  FORMAT_CRON_LEAGUE_LIMIT,
  FORMAT_CRON_REVERT_LIMIT,
  FORMAT_CRON_REVERT_PER_LEAGUE,
  FORMAT_CRON_REVERT_SCAN_LIMIT,
  FORMAT_CRON_ROUND_END_LIMIT,
  FORMAT_CRON_ROUND_END_PER_LEAGUE,
  runFormatCronPass,
} from '../cron';
import { fireEvent, fireLockedActionEvents } from '../fire';
import { onMatchCompleted, onRoundCompleted, revertMatchCompletion } from '../hooks';
import { loadFreshKitContext, type KitContext } from '../load';
import { discardStagedAdminOutcome, finalizeMatchCompletion, stageAdminOutcome } from '@/lib/match/finalize';
import { StagedOutcomeBlockedError } from '@/lib/match/staged-outcome';
import { logAuditEvent } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import { revalidateMatchPages } from '@/lib/revalidation';
import { getSeasonKitHead } from '@/lib/supabase/queries/format-engine';
import { listFinalizedMatches, listKitCronPhases, listKitIdleSeasonIds, listKitSeasonIds, listUncompletedMatches } from '@/lib/supabase/queries/format-cron';
import { completeFormatForfeit, FormatActionAlreadySubmittedError, FormatRuntimeError, openFormatCheck } from '@/lib/supabase/queries/format-runtime';
import { getMatchById, getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { getRoundsByTournament, listRoundStatusesByTournamentIds } from '@/lib/supabase/queries/rounds';
import { listTeamsByTournament } from '@/lib/supabase/queries/teams';

const STAGED = { setAt: '2026-11-06T10:00:00.123456+00:00' };

const SEASON = 's-1';
const PHASE = 't-1';
/** Round 1 opens 2026-06-01 18:00 Berlin (16:00Z) and closes a week later. */
const AFTER_DEADLINE = new Date('2026-06-09T00:00:00Z');
const BEFORE_DEADLINE = new Date('2026-06-03T00:00:00Z');

function calendar(deadlines: DeadlinePolicy[], marks: StageCalendar['marks'] = []): StageCalendar {
  return {
    start: { kind: 'date', date: '2026-06-01' },
    time: '18:00',
    cadence: 'weekly',
    every: 1,
    round_window_hours: 168,
    marks,
    deadlines,
  };
}

function context(cal: StageCalendar, patch: Parameters<typeof stateFor>[1] = {}): KitContext {
  const def = wichtelDef();
  const stage = { ...def.stages[0], calendar: cal };
  return { seasonId: SEASON, seed: SEED, revision: 1, def, state: stateFor(def, patch), tunableIssues: [], phases: [{ id: PHASE, stage, members: PLAYERS }] };
}

const cronPhase = (status = 'active') => ({ id: PHASE, season_id: SEASON, status, format_stage_key: 'swiss', season_start_date: '2026-06-01', clock_shift_seconds: 0 });
const match = (over: Record<string, unknown> = {}) => ({
  id: 'm-1',
  tournament_id: PHASE,
  round_id: 'r-1',
  status: 'scheduled',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'One',
  player_2_name: 'Two',
  winner_id: null,
  ...over,
});
const FIRED = { eventKey: 'k', fired: true, ops: [], notifications: [], issues: [], cascaded: [] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listKitCronPhases).mockResolvedValue([cronPhase()]);
  vi.mocked(listKitSeasonIds).mockResolvedValue([]);
  vi.mocked(listKitIdleSeasonIds).mockResolvedValue([]);
  vi.mocked(listFinalizedMatches).mockResolvedValue([]);
  vi.mocked(onMatchCompleted).mockResolvedValue(true);
  vi.mocked(onRoundCompleted).mockResolvedValue(true);
  vi.mocked(listRoundStatusesByTournamentIds).mockResolvedValue([]);
  vi.mocked(listUncompletedMatches).mockResolvedValue([]);
  vi.mocked(revertMatchCompletion).mockResolvedValue(true);
  vi.mocked(stageAdminOutcome).mockResolvedValue(STAGED);
  vi.mocked(discardStagedAdminOutcome).mockResolvedValue(undefined);
  vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', status: 'in_progress' } as never);
  vi.mocked(fireEvent).mockResolvedValue(FIRED as never);
  vi.mocked(fireLockedActionEvents).mockResolvedValue([]);
  vi.mocked(openFormatCheck).mockResolvedValue('check-1');
  vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r-1', round_number: 1, deadline: null }] as never);
  vi.mocked(getMatchesByTournament).mockResolvedValue([match()] as never);
  vi.mocked(listTeamsByTournament).mockResolvedValue([{ match_id: 'm-1', player_id: 'p1' }] as never);
  vi.mocked(completeFormatForfeit).mockResolvedValue(true);
  vi.mocked(finalizeMatchCompletion).mockResolvedValue({ finalized: true } as never);
  vi.mocked(expireChallenges).mockResolvedValue(0);
  vi.mocked(getSeasonKitHead).mockResolvedValue({ engine: 'kit', seed: SEED, revision: 1, clockShiftSeconds: 0 });
});

describe('time marks', () => {
  const marks = [{ key: 'kickoff', round: 1, offset_hours: 0 }, { key: 'late', round: 2, offset_hours: 0 }];

  it('fires the due marks once and never the ones not due yet', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([], marks)));
    const summary = await runFormatCronPass(BEFORE_DEADLINE);
    expect(vi.mocked(fireEvent).mock.calls.map((call) => call[1])).toEqual([{ event: 'time', stage: 'swiss', mark: 'kickoff' }]);
    expect(summary.marks).toBe(1);
  });

  it('fires several due marks of one pass in calendar order, whatever order the calendar declares them in', async () => {
    // A fork lists the closing mark first: firing it first and the opening one second would reopen the locked window.
    const gifts = [
      { key: 'gifts_close', round: 1, offset_hours: 24 },
      { key: 'gifts_open', round: 1, offset_hours: 0 },
    ];
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([], gifts)));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(fireEvent).mock.calls.map((call) => (call[1] as { mark: string }).mark)).toEqual(['gifts_open', 'gifts_close']);
    expect(summary.marks).toBe(2);
  });

  it('fires a due mark through the context it decided from (the database refuses it when the format moved since)', async () => {
    const decided = context(calendar([], marks));
    vi.mocked(loadFreshKitContext).mockResolvedValue(decided);
    await runFormatCronPass(BEFORE_DEADLINE);
    expect(fireEvent).toHaveBeenCalledWith(SEASON, { event: 'time', stage: 'swiss', mark: 'kickoff' }, null, { context: expect.objectContaining({ revision: decided.revision }) });
  });

  it('stops firing marks when the format changed since the pass read its calendar: a mark that is not due in the new one never burns its key', async () => {
    const gifts = [
      { key: 'gifts_open', round: 1, offset_hours: 0 },
      { key: 'gifts_close', round: 1, offset_hours: 24 },
    ];
    const before = context(calendar([], gifts));
    // The reload after the first fire belongs to another format (a replace landed meanwhile): revision 2 instead of 1.
    vi.mocked(loadFreshKitContext).mockResolvedValueOnce(before).mockResolvedValue({ ...before, revision: before.revision + 1 });
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(fireEvent).mock.calls.map((call) => (call[1] as { mark: string }).mark)).toEqual(['gifts_open']);
    expect(summary.marks).toBe(1);
    expect(summary.failures).toBe(0);
  });

  it('skips a mark whose event key already fired', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([], marks), { firedEventKeys: ['time:swiss:kickoff'] }));
    const summary = await runFormatCronPass(BEFORE_DEADLINE);
    expect(fireEvent).not.toHaveBeenCalled();
    expect(summary.marks).toBe(0);
  });

  it('fires a calendar mark of a later round with no round generated, and not before it is due', async () => {
    const week4 = [{ key: 'week4', round: 4, offset_hours: 0 }];
    vi.mocked(listKitCronPhases).mockResolvedValue([cronPhase('upcoming')]);
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([], week4)));
    // Round 4 opens 2026-06-22 16:00Z; no round exists in the tournament (getRoundsByTournament is not even read).
    await runFormatCronPass(new Date('2026-06-22T15:00:00Z'));
    expect(fireEvent).not.toHaveBeenCalled();
    await runFormatCronPass(new Date('2026-06-22T17:00:00Z'));
    expect(vi.mocked(fireEvent).mock.calls.map((call) => call[1])).toEqual([{ event: 'time', stage: 'swiss', mark: 'week4' }]);
    expect(getRoundsByTournament).not.toHaveBeenCalled();
  });

  it('fires marks of an upcoming phase but applies no policy', async () => {
    vi.mocked(listKitCronPhases).mockResolvedValue([cronPhase('upcoming')]);
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([{ applies: 'match', offset_hours: 0, on_miss: 'forfeit' }], marks)));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(fireEvent).toHaveBeenCalled();
    expect(getRoundsByTournament).not.toHaveBeenCalled();
  });
});

describe('match and team policies', () => {
  const forfeit: DeadlinePolicy = { applies: 'match', offset_hours: 0, on_miss: 'forfeit' };

  it('does nothing before the round deadline', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    await runFormatCronPass(BEFORE_DEADLINE);
    expect(completeFormatForfeit).not.toHaveBeenCalled();
    expect(openFormatCheck).not.toHaveBeenCalled();
  });

  it('forfeits the side without a team and finalizes with a system forfeit outcome', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(completeFormatForfeit).toHaveBeenCalledWith({ seasonId: SEASON, matchId: 'm-1', expectedStatus: 'scheduled', winnerId: 'p1', revision: 1 });
    const input = vi.mocked(finalizeMatchCompletion).mock.calls[0][0];
    expect(input.winnerId).toBe('p1');
    expect(input.previousStatus).toBe('scheduled');
    expect(input.adminOutcome).toMatchObject({ kind: 'forfeit', setBy: null });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actor_id: null, actor_name: 'System', metadata: expect.objectContaining({ loser_id: 'p2' }) }));
    expect(summary.forfeits).toBe(1);
  });

  it.each([
    ['a league taken off the kit engine', { engine: 'shadow', seed: SEED, revision: 1, clockShiftSeconds: 0 }],
    ['a format replaced or amended since the pass read it', { engine: 'kit', seed: SEED, revision: 2, clockShiftSeconds: 0 }],
    ['a league whose format was detached', null],
  ] as const)('forfeits nothing in %s: the head is read again right before the first write', async (_label, head) => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(getSeasonKitHead).mockResolvedValue(head as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(stageAdminOutcome).not.toHaveBeenCalled();
    expect(completeFormatForfeit).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ forfeits: 0, failures: 0 });
  });

  it('takes back its staged row and finalizes nothing when the database refuses a stale format, even if the match was completed meanwhile', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(completeFormatForfeit).mockRejectedValue(new FormatRuntimeError('format_context_stale'));
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', status: 'completed' } as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(discardStagedAdminOutcome).toHaveBeenCalledWith('m-1', STAGED);
    expect(finalizeMatchCompletion).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ forfeits: 0, failures: 0 });
  });

  it('finalizes the forfeit even when the cache expiry throws after the status flip', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(revalidateMatchPages).mockRejectedValue(new Error('tournament read failed'));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(finalizeMatchCompletion).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ forfeits: 1, failures: 0 });
    expect(logger.error).toHaveBeenCalledWith('format-engine/cron', expect.stringContaining('expire the pages'), expect.objectContaining({ matchId: 'm-1' }));
  });

  it('stored round deadlines win over the calendar', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r-1', round_number: 1, deadline: '2026-06-20T00:00:00Z' }] as never);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(completeFormatForfeit).not.toHaveBeenCalled();
  });

  it('writes the forfeit outcome before the status flip', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    const order: string[] = [];
    vi.mocked(stageAdminOutcome).mockImplementation(async () => {
      order.push('outcome');
      return STAGED;
    });
    vi.mocked(completeFormatForfeit).mockImplementation(async () => {
      order.push('status');
      return true;
    });
    await runFormatCronPass(AFTER_DEADLINE);
    expect(order).toEqual(['outcome', 'status']);
    expect(stageAdminOutcome).toHaveBeenCalledWith('m-1', { kind: 'forfeit', reason: expect.any(String), setBy: null });
    expect(discardStagedAdminOutcome).not.toHaveBeenCalled();
  });

  it('leaves the match alone when the forfeit outcome cannot be written', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(stageAdminOutcome).mockRejectedValue(new Error('db'));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(completeFormatForfeit).not.toHaveBeenCalled();
    expect(finalizeMatchCompletion).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ forfeits: 0, failures: 1 });
  });

  it('leaves a match that changed meanwhile alone (compare-and-set miss) and removes the staged outcome', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(completeFormatForfeit).mockResolvedValue(false);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(finalizeMatchCompletion).not.toHaveBeenCalled();
    expect(summary.forfeits).toBe(0);
    expect(discardStagedAdminOutcome).toHaveBeenCalledWith('m-1', STAGED);
  });

  it('takes back its own staged row when another writer completed the match meanwhile (it may have kept our row without admin intent)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(completeFormatForfeit).mockResolvedValue(false);
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', status: 'completed' } as never);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(discardStagedAdminOutcome).toHaveBeenCalledWith('m-1', STAGED);
  });

  it('keeps the row of a completed match when nothing identifies it as ours (no handle)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(stageAdminOutcome).mockResolvedValue(null);
    vi.mocked(completeFormatForfeit).mockResolvedValue(false);
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', status: 'completed' } as never);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(discardStagedAdminOutcome).not.toHaveBeenCalled();
  });

  it('keeps the outcome when the status of the match cannot be read after a miss', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(completeFormatForfeit).mockResolvedValue(false);
    vi.mocked(getMatchById).mockRejectedValue(new Error('db'));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(discardStagedAdminOutcome).not.toHaveBeenCalled();
  });

  it('removes the staged outcome when the status write throws', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(completeFormatForfeit).mockRejectedValue(new Error('db'));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(discardStagedAdminOutcome).toHaveBeenCalledWith('m-1', STAGED);
    expect(summary.failures).toBe(1);
  });

  it('keeps the row when the status write threw but the match is completed (the write may have been ours)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(completeFormatForfeit).mockRejectedValue(new Error('timeout'));
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', status: 'completed' } as never);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(discardStagedAdminOutcome).not.toHaveBeenCalled();
  });

  it('leaves a match a replay-tie disputed meanwhile alone: no forfeit, no failure, nothing completed', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(stageAdminOutcome).mockRejectedValue(new StagedOutcomeBlockedError('disputed'));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(completeFormatForfeit).not.toHaveBeenCalled();
    expect(finalizeMatchCompletion).not.toHaveBeenCalled();
    expect(discardStagedAdminOutcome).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ forfeits: 0, failures: 0 });
  });

  it('opens a check instead when both or neither side has a team', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(listTeamsByTournament).mockResolvedValue([]);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(completeFormatForfeit).not.toHaveBeenCalled();
    expect(openFormatCheck).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'deadline_missed', ruleId: 'deadline:swiss:0', dedupeKey: 'deadline:swiss:0:m-1', subject: expect.objectContaining({ reason: 'undecidable_forfeit' }) }),
    );
    expect(summary.checks).toBe(1);
  });

  it('skips completed matches and matches whose check exists', async () => {
    const review: DeadlinePolicy = { applies: 'match', offset_hours: 0, on_miss: 'admin_review' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(
      context(calendar([review]), {
        checks: [{ id: 'c', source: 'deadline_missed', rule_id: 'deadline:swiss:0', dedupe_key: 'deadline:swiss:0:m-1', subject: {}, status: 'open', note: null }],
      }),
    );
    vi.mocked(getMatchesByTournament).mockResolvedValue([match(), match({ id: 'm-2', status: 'completed' })] as never);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(openFormatCheck).not.toHaveBeenCalled();
  });

  it('a team policy ignores matches where both sides registered', async () => {
    const team: DeadlinePolicy = { applies: 'team', offset_hours: -48, on_miss: 'admin_review' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([team])));
    vi.mocked(listTeamsByTournament).mockResolvedValue([{ match_id: 'm-1', player_id: 'p1' }, { match_id: 'm-1', player_id: 'p2' }] as never);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(openFormatCheck).not.toHaveBeenCalled();
  });

  describe('a planned team (no match) counts as registered, like getPlayerTeamForMatch', () => {
    it('a team policy ignores a match where one side has a linked and the other a planned team', async () => {
      const team: DeadlinePolicy = { applies: 'team', offset_hours: -48, on_miss: 'forfeit' };
      vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([team])));
      vi.mocked(listTeamsByTournament).mockResolvedValue([{ match_id: 'm-1', player_id: 'p1' }, { match_id: null, player_id: 'p2' }] as never);
      const summary = await runFormatCronPass(AFTER_DEADLINE);
      expect(openFormatCheck).not.toHaveBeenCalled();
      expect(completeFormatForfeit).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ forfeits: 0, checks: 0 });
    });

    it('forfeits the side without any team when the other side has only a planned one', async () => {
      const forfeit: DeadlinePolicy = { applies: 'match', offset_hours: 0, on_miss: 'forfeit' };
      vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
      vi.mocked(listTeamsByTournament).mockResolvedValue([{ match_id: null, player_id: 'p1' }] as never);
      const summary = await runFormatCronPass(AFTER_DEADLINE);
      expect(completeFormatForfeit).toHaveBeenCalledWith({ seasonId: SEASON, matchId: 'm-1', expectedStatus: 'scheduled', winnerId: 'p1', revision: 1 });
      expect(summary.forfeits).toBe(1);
    });

    it('does not count a team linked to another match', async () => {
      const forfeit: DeadlinePolicy = { applies: 'match', offset_hours: 0, on_miss: 'forfeit' };
      vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
      vi.mocked(listTeamsByTournament).mockResolvedValue([{ match_id: null, player_id: 'p1' }, { match_id: 'm-9', player_id: 'p2' }] as never);
      const summary = await runFormatCronPass(AFTER_DEADLINE);
      expect(completeFormatForfeit).toHaveBeenCalledWith({ seasonId: SEASON, matchId: 'm-1', expectedStatus: 'scheduled', winnerId: 'p1', revision: 1 });
      expect(summary.forfeits).toBe(1);
    });
  });
});

describe('action policies', () => {
  const links = [link('p1', 'p2'), link('p3', 'p4')];
  const OPEN_FLAGS = { 'domain:new_year': 'unlocked', 'action:give_gifts': 'open' };

  it('auto_lock locks the action once, under its own mark', async () => {
    const lock: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'auto_lock' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([lock]), { links }));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(fireEvent).toHaveBeenCalledWith(SEASON, { event: 'time', stage: 'swiss', mark: 'deadline:swiss:0' }, null, expect.objectContaining({ ops: [{ op: 'lock_action', action: 'give_gifts' }] }));
    expect(summary.locks).toBe(1);

    vi.mocked(fireEvent).mockClear();
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([lock]), { links, firedEventKeys: ['time:swiss:deadline:swiss:0'] }));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('counts no failure when the lock of a policy is refused as stale (the format changed since the pass loaded it): the next pass retries', async () => {
    const lock: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'auto_lock' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([lock]), { links }));
    vi.mocked(fireEvent).mockRejectedValue(new FormatRuntimeError('format_context_stale'));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary).toMatchObject({ locks: 0, failures: 0 });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('format-engine/cron', expect.stringContaining('the format changed meanwhile'), expect.objectContaining({ policy: 0 }));
  });

  it('admin_review opens a check per player without a submission', async () => {
    const review: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'admin_review' };
    const submitted = { id: 'sub', action: 'give_gifts', actor: 'p1', target: 'p2', status: 'submitted' as const, picks: [] };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([review]), { links, submissions: [submitted] }));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(openFormatCheck).mock.calls.map((call) => call[0].dedupeKey)).toEqual(['deadline:swiss:0:give_gifts:p3']);
    expect(summary.checks).toBe(1);
  });

  describe('in an upcoming phase (an action window before round 1)', () => {
    const review: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'admin_review' };
    const forfeit: DeadlinePolicy = { applies: 'match', offset_hours: 0, on_miss: 'forfeit' };
    const roundPolicy: DeadlinePolicy = { applies: 'team', offset_hours: 0, on_miss: 'admin_review' };
    const draft = { id: 'sub', action: 'give_gifts', actor: 'p1', target: 'p2', status: 'draft' as const, picks: [] };
    const submitted = { ...draft, id: 'sub-2', actor: 'p3', target: 'p4', status: 'submitted' as const };

    beforeEach(() => {
      vi.mocked(listKitCronPhases).mockResolvedValue([cronPhase('upcoming')]);
    });

    it('opens a check per giver without a non-draft submission once the deadline passed', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([review]), { links, submissions: [draft, submitted] }));
      const summary = await runFormatCronPass(AFTER_DEADLINE);
      // A draft is not a submission: p1 is still waiting; p3 submitted.
      expect(vi.mocked(openFormatCheck).mock.calls.map((call) => call[0].dedupeKey)).toEqual(['deadline:swiss:0:give_gifts:p1']);
      expect(summary.checks).toBe(1);
    });

    it('opens nothing before the action deadline', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([review]), { links }));
      // Round 1 has not opened yet, which is the anchor of an action without a closing mark.
      await runFormatCronPass(new Date('2026-05-30T00:00:00Z'));
      expect(openFormatCheck).not.toHaveBeenCalled();
    });

    it('does not open the same check twice', async () => {
      const checks = [{ id: 'c', source: 'deadline_missed' as const, rule_id: 'deadline:swiss:0', dedupe_key: 'deadline:swiss:0:give_gifts:p1', subject: {}, status: 'open' as const, note: null }];
      vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([review]), { links: [link('p1', 'p2')], checks }));
      await runFormatCronPass(AFTER_DEADLINE);
      expect(openFormatCheck).not.toHaveBeenCalled();
    });

    it('locks the action under the policy mark', async () => {
      const lock: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'auto_lock' };
      vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([lock]), { links }));
      const summary = await runFormatCronPass(AFTER_DEADLINE);
      expect(summary.locks).toBe(1);
    });

    it('skips match, team and round policies but keeps the position of the action policy in its key', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit, roundPolicy, review]), { links: [link('p1', 'p2')] }));
      const summary = await runFormatCronPass(AFTER_DEADLINE);
      expect(getRoundsByTournament).not.toHaveBeenCalled();
      expect(getMatchesByTournament).not.toHaveBeenCalled();
      expect(completeFormatForfeit).not.toHaveBeenCalled();
      expect(vi.mocked(openFormatCheck).mock.calls.map((call) => call[0].dedupeKey)).toEqual(['deadline:swiss:2:give_gifts:p1']);
      expect(summary.checks).toBe(1);
    });

    it('runs the same match policy once the phase is active', async () => {
      vi.mocked(listKitCronPhases).mockResolvedValue([cronPhase('active')]);
      vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
      await runFormatCronPass(AFTER_DEADLINE);
      expect(getRoundsByTournament).toHaveBeenCalled();
    });

    it('reloads the context after an action policy that applied something', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([review]), { links: [link('p1', 'p2')] }));
      await runFormatCronPass(AFTER_DEADLINE);
      // once for the league, once after the check was opened
      expect(loadFreshKitContext).toHaveBeenCalledTimes(2);
    });
  });

  it('seeded_random_pick submits a valid pick for each player who has none', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([pick]), { links, flags: OPEN_FLAGS }));
    vi.mocked(submitAction).mockResolvedValue({ ok: true, submission: {} } as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(submitAction).mock.calls.map((call) => call[0])).toEqual([
      { seasonId: SEASON, actionId: 'give_gifts', actorId: 'p1', picks: [{ step: 0, item_id: 'garchomp' }], audience: 'system', onlyIfUnsubmitted: true, expectedRevision: 1 },
      { seasonId: SEASON, actionId: 'give_gifts', actorId: 'p3', picks: [{ step: 0, item_id: 'garchomp' }], audience: 'system', onlyIfUnsubmitted: true, expectedRevision: 1 },
    ]);
    expect(summary.picks).toBe(2);
  });

  it('audits each pick it draws as System, naming the player unless a relation still hides the giver', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    vi.mocked(submitAction).mockResolvedValue({ ok: true, submission: {} } as never);
    const withFromSide = (from: 'all' | 'hidden') => {
      const ctx = context(calendar([pick]), { links, flags: OPEN_FLAGS });
      ctx.def = { ...ctx.def, relations: (ctx.def.relations ?? []).map((r) => ({ ...r, visibility: { from, to: 'own' } })) } as never;
      return ctx;
    };
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFromSide('all'));
    await runFormatCronPass(AFTER_DEADLINE);
    const entries = vi.mocked(logAuditEvent).mock.calls.map((call) => call[0]).filter((entry) => entry.action === 'season.format.action.auto_pick');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      actor_id: null,
      actor_name: 'System',
      resource_type: 'season',
      resource_id: SEASON,
      metadata: { via: 'seeded_random_pick', action_id: 'give_gifts', pick_count: 1, player_id: 'p1' },
    });

    // A relation whose giver side is hidden and not revealed: the entry names no player.
    vi.mocked(logAuditEvent).mockClear();
    vi.mocked(submitAction).mockResolvedValue({ ok: true, submission: {}, giverHidden: true } as never);
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFromSide('hidden'));
    await runFormatCronPass(AFTER_DEADLINE);
    const hidden = vi.mocked(logAuditEvent).mock.calls.map((call) => call[0]).filter((entry) => entry.action === 'season.format.action.auto_pick');
    expect(hidden).toHaveLength(2);
    for (const entry of hidden) {
      expect(entry.metadata).toEqual({ via: 'seeded_random_pick', action_id: 'give_gifts', pick_count: 1, giver_hidden: true });
      expect(JSON.stringify(entry)).not.toMatch(/p1|p3/);
    }
  });

  it('a late pass applies a seeded pick due before the closing mark first, so the mark cannot lock it out', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    const marks = [{ key: 'gifts_close', round: 1, offset_hours: 24 }];
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([pick], marks), { links, flags: OPEN_FLAGS }));
    vi.mocked(submitAction).mockResolvedValue({ ok: true, submission: {}, giverHidden: false } as never);
    vi.mocked(fireEvent).mockResolvedValue(FIRED as never);

    const summary = await runFormatCronPass(AFTER_DEADLINE);

    expect(summary.picks).toBe(2);
    expect(summary.marks).toBe(1);
    const lastPick = Math.max(...vi.mocked(submitAction).mock.invocationCallOrder);
    expect(lastPick).toBeLessThan(vi.mocked(fireEvent).mock.invocationCallOrder[0]);
  });

  it('a late pass fires a mark due before the pick first', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 48, on_miss: 'seeded_random_pick' };
    const marks = [{ key: 'gifts_open', round: 1, offset_hours: 0 }];
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([pick], marks), { links, flags: OPEN_FLAGS }));
    vi.mocked(submitAction).mockResolvedValue({ ok: true, submission: {}, giverHidden: false } as never);
    vi.mocked(fireEvent).mockResolvedValue(FIRED as never);

    await runFormatCronPass(AFTER_DEADLINE);

    expect(vi.mocked(fireEvent).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(submitAction).mock.invocationCallOrder[0]);
  });

  it('stops drawing, submits nothing and opens no check when the format changed since the pass read the policy', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    const before = context(calendar([pick]), { links, flags: OPEN_FLAGS });
    vi.mocked(loadFreshKitContext).mockResolvedValueOnce(before).mockResolvedValue({ ...before, revision: before.revision + 1 });
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(submitAction).not.toHaveBeenCalled();
    expect(openFormatCheck).not.toHaveBeenCalled();
    expect(summary.picks).toBe(0);
  });

  it('opens a no-valid-pick check under the revision of the pass', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    const ctx = context(calendar([pick]), { links: [link('p1', 'p2')], flags: OPEN_FLAGS });
    vi.mocked(loadFreshKitContext).mockResolvedValue({ ...ctx, revision: 1 });
    vi.mocked(submitAction).mockResolvedValue({ ok: false, issues: [{ code: 'window_closed' }] });
    await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(openFormatCheck).mock.calls.every((call) => call[0].revision === 1)).toBe(true);
    expect(openFormatCheck).toHaveBeenCalled();
  });

  it('draws nothing and opens no check for a giver who is no longer in the league (their link stays), and still draws for the others', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    vi.mocked(submitAction).mockResolvedValue({ ok: true, submission: {} } as never);
    const ctx = context(calendar([pick]), { links, flags: OPEN_FLAGS });
    // p1 holds a link as a giver but an admin took them out of every phase after the draw; p3 is still enrolled.
    ctx.phases = ctx.phases.map((phase) => ({ ...phase, members: phase.members.filter((m) => m !== 'p1') }));
    vi.mocked(loadFreshKitContext).mockResolvedValue(ctx);

    const summary = await runFormatCronPass(AFTER_DEADLINE);

    expect(vi.mocked(submitAction).mock.calls.map((call) => call[0].actorId)).toEqual(['p3']);
    expect(summary.picks).toBe(1);
    expect(openFormatCheck).not.toHaveBeenCalled();
    const entries = vi.mocked(logAuditEvent).mock.calls.map((call) => call[0]).filter((entry) => entry.action === 'season.format.action.auto_pick');
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain('p1');
  });

  it('opens no admin-review check for a giver who is no longer in the league', async () => {
    const review: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'admin_review' };
    const ctx = context(calendar([review]), { links, flags: OPEN_FLAGS });
    ctx.phases = ctx.phases.map((phase) => ({ ...phase, members: phase.members.filter((m) => m !== 'p1') }));
    vi.mocked(loadFreshKitContext).mockResolvedValue(ctx);

    await runFormatCronPass(AFTER_DEADLINE);

    expect(vi.mocked(openFormatCheck).mock.calls.map((call) => JSON.stringify(call[0]))).toEqual([expect.stringContaining('p3')]);
    expect(vi.mocked(openFormatCheck).mock.calls.some((call) => JSON.stringify(call[0]).includes('p1'))).toBe(false);
  });

  it('writes no audit entry for a pick it could not draw or that was refused', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([pick]), { links: [link('p1', 'p2')], flags: OPEN_FLAGS }));
    vi.mocked(submitAction).mockResolvedValue({ ok: false, issues: [{ code: 'window_closed' }] });
    await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(logAuditEvent).mock.calls.filter((call) => call[0].action === 'season.format.action.auto_pick')).toHaveLength(0);
  });

  it('leaves a player alone who submitted after the pass started (the draw never replaces their choice)', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    const stale = context(calendar([pick]), { links, flags: OPEN_FLAGS });
    const late = { id: 'sub', action: 'give_gifts', actor: 'p3', target: 'p4', status: 'submitted' as const, picks: [] };
    const draft = { ...late, id: 'sub-draft', status: 'draft' as const };
    // The league load and p1's fresh load predate p3's submission; p3's fresh load has it. A draft does not count.
    vi.mocked(loadFreshKitContext)
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(context(calendar([pick]), { links, flags: OPEN_FLAGS, submissions: [draft] }))
      .mockResolvedValue(context(calendar([pick]), { links, flags: OPEN_FLAGS, submissions: [late] }));
    vi.mocked(submitAction).mockResolvedValue({ ok: true, submission: {} } as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(submitAction).mock.calls.map((call) => call[0].actorId)).toEqual(['p1']);
    expect(openFormatCheck).not.toHaveBeenCalled();
    expect(summary.picks).toBe(1);
  });

  it('leaves a player alone whose pick the database found already submitted (no count, no audit entry, no check)', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([pick]), { links, flags: OPEN_FLAGS }));
    // p1 submits between the cron's read and the write: the function refuses to overwrite; p3 is drawn as usual.
    vi.mocked(submitAction)
      .mockRejectedValueOnce(new FormatActionAlreadySubmittedError())
      .mockResolvedValue({ ok: true, submission: {} } as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(submitAction).mock.calls.map((call) => call[0].actorId)).toEqual(['p1', 'p3']);
    expect(summary.picks).toBe(1);
    expect(summary.failures).toBe(0);
    const audited = vi.mocked(logAuditEvent).mock.calls.map((call) => call[0]).filter((entry) => entry.action === 'season.format.action.auto_pick');
    expect(audited).toHaveLength(1);
    expect(openFormatCheck).not.toHaveBeenCalled();
  });

  it('leaves a player alone whose pick the database found locked (action_locked), and still draws for the others', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([pick]), { links, flags: OPEN_FLAGS }));
    // p1 submits and locks (lock: 'on_submit') between the cron's read and the write: the function answers action_locked
    // (it checks the lock before p_only_if_unsubmitted). That is no failure and does not stop p3's draw.
    vi.mocked(submitAction)
      .mockRejectedValueOnce(new FormatRuntimeError('action_locked'))
      .mockResolvedValue({ ok: true, submission: {} } as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(submitAction).mock.calls.map((call) => call[0].actorId)).toEqual(['p1', 'p3']);
    expect(summary.picks).toBe(1);
    expect(summary.failures).toBe(0);
    const audited = vi.mocked(logAuditEvent).mock.calls.map((call) => call[0]).filter((entry) => entry.action === 'season.format.action.auto_pick');
    expect(audited).toHaveLength(1);
    expect(openFormatCheck).not.toHaveBeenCalled();
  });

  it.each(['format_context_stale', 'resource_capacity_reached', 'resource_item_taken'] as const)(
    'skips a draw the database refused as %s (the format or the holding changed meanwhile), retries it next pass and still draws for the others',
    async (code) => {
      const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
      vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([pick]), { links, flags: OPEN_FLAGS }));
      vi.mocked(submitAction)
        .mockRejectedValueOnce(new FormatRuntimeError(code))
        .mockResolvedValue({ ok: true, submission: {} } as never);
      const summary = await runFormatCronPass(AFTER_DEADLINE);
      expect(vi.mocked(submitAction).mock.calls.map((call) => call[0].actorId)).toEqual(['p1', 'p3']);
      expect(summary.picks).toBe(1);
      expect(summary.failures).toBe(0);
      // No count, no audit entry and no check for the skipped player: the next pass draws for them again.
      const audited = vi.mocked(logAuditEvent).mock.calls.map((call) => call[0]).filter((entry) => entry.action === 'season.format.action.auto_pick');
      expect(audited).toHaveLength(1);
      expect(openFormatCheck).not.toHaveBeenCalled();
    },
  );

  it('still fails the policy on a refusal a concurrent writer cannot have caused (domain_amendment_locked)', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([pick]), { links, flags: OPEN_FLAGS }));
    vi.mocked(submitAction).mockRejectedValue(new FormatRuntimeError('domain_amendment_locked'));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary.failures).toBeGreaterThan(0);
    expect(summary.picks).toBe(0);
  });

  it('opens a check when no valid pick exists (the domain is locked)', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([pick]), { links: [link('p1', 'p2')] }));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(submitAction).not.toHaveBeenCalled();
    expect(openFormatCheck).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: 'deadline:swiss:0:give_gifts:p1', subject: expect.objectContaining({ reason: 'no_valid_pick' }) }));
  });

  it('opens a check when the submission is refused', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([pick]), { links: [link('p1', 'p2')], flags: OPEN_FLAGS }));
    vi.mocked(submitAction).mockResolvedValue({ ok: false, issues: [{ code: 'window_closed' }] });
    await runFormatCronPass(AFTER_DEADLINE);
    expect(openFormatCheck).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.objectContaining({ reason: 'window_closed' }) }));
  });
});

describe('lost action_locked cascades', () => {
  it('fires the pending lock events of a league at the start of its pass and reloads the context', async () => {
    vi.mocked(fireLockedActionEvents).mockResolvedValue(['action_locked:give_gifts']);
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(fireLockedActionEvents).toHaveBeenCalledWith(SEASON, null, expect.objectContaining({ context: expect.objectContaining({ seasonId: SEASON }) }));
    expect(loadFreshKitContext).toHaveBeenCalledTimes(2);
  });

  it('does not reload when no lock event was pending', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(loadFreshKitContext).toHaveBeenCalledTimes(1);
  });
});

describe('match_completed backfill', () => {
  const finalized = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    tournament_id: PHASE,
    round_id: 'r-1',
    player_1_id: 'p1',
    player_2_id: 'p2',
    winner_id: 'p1',
    ...over,
  });

  it('fires the hook for a finalized match whose event never fired, and for none that fired', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([]), { firedEventKeys: ['match_completed:m-1'] }));
    vi.mocked(listFinalizedMatches).mockResolvedValue([finalized('m-1'), finalized('m-2')] as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(onMatchCompleted).mock.calls).toEqual([
      [
        {
          tournament: { id: PHASE, season_id: SEASON, season_format_type: 'custom' },
          matchId: 'm-2',
          roundId: 'r-1',
          player1Id: 'p1',
          player2Id: 'p2',
          winnerId: 'p1',
          auditRetry: 'always',
          report: { stale: false, failed: false },
        },
      ],
    ]);
    expect(summary.completions_backfilled).toBe(1);
    expect(listFinalizedMatches).toHaveBeenCalledWith([PHASE]);
    // the hook fired events: the context is reloaded
    expect(loadFreshKitContext).toHaveBeenCalledTimes(2);
  });

  it('respects the generation of a reverted and re-completed match', async () => {
    // completed once (gen 0), reverted once, completed again: the key to look for is match_completed:m-1:1
    const fired = ['match_completed:m-1', 'match_reverted:m-1:1'];
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([]), { firedEventKeys: fired }));
    vi.mocked(listFinalizedMatches).mockResolvedValue([finalized('m-1')] as never);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(onMatchCompleted).toHaveBeenCalledTimes(1);

    vi.mocked(onMatchCompleted).mockClear();
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([]), { firedEventKeys: [...fired, 'match_completed:m-1:1'] }));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(onMatchCompleted).not.toHaveBeenCalled();
  });

  it('is bounded per league and per run, and a failed hook counts and is retried next run', async () => {
    const many = Array.from({ length: 40 }, (_, i) => finalized(`m-${String(i).padStart(2, '0')}`));
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    vi.mocked(listFinalizedMatches).mockResolvedValue(many as never);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(onMatchCompleted).toHaveBeenCalledTimes(FORMAT_CRON_BACKFILL_PER_LEAGUE);

    // Three leagues of 40 missing matches: the run stops at its budget.
    vi.mocked(onMatchCompleted).mockClear();
    vi.mocked(listKitCronPhases).mockResolvedValue(['s-1', 's-2', 's-3'].map((id, i) => ({ ...cronPhase(), id: `t-${i}`, season_id: id })));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(onMatchCompleted).toHaveBeenCalledTimes(FORMAT_CRON_BACKFILL_LIMIT);

    vi.mocked(onMatchCompleted).mockClear();
    vi.mocked(listKitCronPhases).mockResolvedValue([cronPhase()]);
    vi.mocked(onMatchCompleted).mockResolvedValue(false);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary).toMatchObject({ completions_backfilled: 0, failures: FORMAT_CRON_BACKFILL_PER_LEAGUE });
  });

  it('a hook that reports a stale format is retry-later: a warning, no immediate repeat, no failure', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    vi.mocked(listFinalizedMatches).mockResolvedValue([finalized('m-1')] as never);
    // `guarded` in the hook swallows format_context_stale and reports it here, so the pass never sees the error itself
    vi.mocked(onMatchCompleted).mockImplementation(async (input) => {
      if (input.report !== undefined) input.report.stale = true;
      return false;
    });
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(onMatchCompleted).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ completions_backfilled: 0, failures: 0 });
    expect(logger.error).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn).mock.calls.some(([, message]) => String(message).includes('backfill skipped'))).toBe(true);
  });

  it('a hook that is stale and also failed in another step still counts as a failure', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    vi.mocked(listFinalizedMatches).mockResolvedValue([finalized('m-1')] as never);
    vi.mocked(onMatchCompleted).mockImplementation(async (input) => {
      if (input.report !== undefined) Object.assign(input.report, { stale: true, failed: true });
      return false;
    });
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary).toMatchObject({ completions_backfilled: 0, failures: 1 });
  });

  it('repeats a failed hook once, giving up on a transient team audit failure the second time', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    vi.mocked(listFinalizedMatches).mockResolvedValue([finalized('m-1')] as never);
    // the audit timed out once: the repeat reports it as unavailable instead of losing the audit
    vi.mocked(onMatchCompleted).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(onMatchCompleted).mock.calls.map(([call]) => call.auditRetry)).toEqual(['always', 'never']);
    expect(summary).toMatchObject({ completions_backfilled: 1, failures: 0 });

    // a hook that fails twice is a failure of the run, and the match stays missing for the next one
    vi.mocked(onMatchCompleted).mockClear();
    vi.mocked(onMatchCompleted).mockResolvedValue(false);
    const failed = await runFormatCronPass(AFTER_DEADLINE);
    expect(onMatchCompleted).toHaveBeenCalledTimes(2);
    expect(failed).toMatchObject({ completions_backfilled: 0, failures: 1 });
  });

  it('hands the matches to the hook in the order the query lists them (finish order)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    vi.mocked(listFinalizedMatches).mockResolvedValue([finalized('m-9'), finalized('m-1'), finalized('m-5')] as never);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(onMatchCompleted).mock.calls.map(([call]) => call.matchId)).toEqual(['m-9', 'm-1', 'm-5']);
  });

  it('rotates the league order, so three leagues with persistently failing hooks cannot starve a fourth for ever', async () => {
    const seasons = ['s-a', 's-b', 's-c', 's-d'];
    vi.mocked(listKitCronPhases).mockResolvedValue(seasons.map((id) => ({ ...cronPhase(), id: `t-${id}`, season_id: id })));
    vi.mocked(loadFreshKitContext).mockImplementation(async (seasonId: string) => {
      const base = context(calendar([]));
      return { ...base, seasonId, phases: [{ ...base.phases[0], id: `t-${seasonId}` }] };
    });
    // s-a..s-c hold 10 missing matches each whose hook always fails; s-d one that would succeed.
    vi.mocked(listFinalizedMatches).mockImplementation(async (ids: readonly string[]) =>
      (ids[0] === 't-s-d' ? [finalized('good')] : Array.from({ length: 10 }, (_, i) => finalized(`bad-${ids[0]}-${i}`))) as never,
    );
    vi.mocked(onMatchCompleted).mockImplementation(async (input) => input.matchId === 'good');
    const reached = new Set<number>();
    for (let n = 0; n < seasons.length; n += 1) {
      vi.mocked(onMatchCompleted).mockClear();
      const now = new Date((4000 + n) * 15 * 60_000);
      const summary = await runFormatCronPass(now);
      if (summary.completions_backfilled > 0) reached.add(n);
    }
    // the fourth league is reached in at least one of four consecutive slots (before the rotation: never)
    expect(reached.size).toBeGreaterThan(0);
  });

  it('cronOrderOffset moves on by one league per slot, wrapping around', () => {
    const slot = (n: number) => new Date(n * 15 * 60_000);
    expect(cronOrderOffset(slot(7), 1)).toBe(0);
    expect(cronOrderOffset(slot(7), 0)).toBe(0);
    const offsets = [0, 1, 2, 3, 4].map((n) => cronOrderOffset(slot(100 + n), 4));
    expect(new Set(offsets).size).toBe(4);
    expect(offsets[4]).toBe(offsets[0]);
  });

  it('runs for a kit league without any calendar too', async () => {
    vi.mocked(listKitCronPhases).mockResolvedValue([]);
    vi.mocked(listKitSeasonIds).mockResolvedValue([SEASON]);
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    vi.mocked(listFinalizedMatches).mockResolvedValue([finalized('m-1')] as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(fireLockedActionEvents).toHaveBeenCalledWith(SEASON, null, expect.anything());
    expect(summary).toMatchObject({ leagues: 1, completions_backfilled: 1 });
  });

  it('does not run a league twice when it also has phases with a calendar', async () => {
    vi.mocked(listKitSeasonIds).mockResolvedValue([SEASON]);
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary.leagues).toBe(1);
  });

  it('counts a failed league listing without stopping the pass', async () => {
    vi.mocked(listKitSeasonIds).mockRejectedValue(new Error('db'));
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary).toMatchObject({ leagues: 1, failures: 1 });
  });
});

describe('pending match_reverted', () => {
  const open = (id: string, status = 'in_progress') => ({ id, tournament_id: PHASE, status });
  const withFired = (fired: string[]) => context(calendar([]), { firedEventKeys: fired });

  it('names the matches whose current completion key fired, honouring the generation', () => {
    expect(
      currentlyCompletedMatchIds([
        'match_completed:m-2',
        'match_completed:m-1',
        'match_reverted:m-1:1',
        'match_completed:m-3',
        'match_reverted:m-3:1',
        'match_completed:m-3:1',
        'time:swiss:kickoff',
      ]),
    ).toEqual(['m-2', 'm-3']);
  });

  it('reverts a match that left completed while its completion key is still the current one', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFired(['match_completed:m-1', 'match_completed:m-2']));
    vi.mocked(listUncompletedMatches).mockResolvedValue([open('m-2')]);
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-2', status: 'in_progress' } as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(listUncompletedMatches).toHaveBeenCalledWith([PHASE], ['m-1', 'm-2']);
    expect(revertMatchCompletion).toHaveBeenCalledTimes(1);
    expect(revertMatchCompletion).toHaveBeenCalledWith({ tournamentId: PHASE, matchId: 'm-2', report: { stale: false, failed: false } });
    expect(summary.failures).toBe(0);
    // the revert fired events: the context is reloaded
    expect(loadFreshKitContext).toHaveBeenCalledTimes(2);
  });

  it('reverts nothing when every match with a fired key is still completed, and reads nothing without a fired key', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFired(['match_completed:m-1']));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(revertMatchCompletion).not.toHaveBeenCalled();
    expect(loadFreshKitContext).toHaveBeenCalledTimes(1);

    vi.mocked(listUncompletedMatches).mockClear();
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFired([]));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(listUncompletedMatches).not.toHaveBeenCalled();
  });

  it('does not revert a completion once its revert event fired (the next completion is a new key)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFired(['match_completed:m-1', 'match_reverted:m-1:1']));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(listUncompletedMatches).not.toHaveBeenCalled();
    expect(revertMatchCompletion).not.toHaveBeenCalled();
  });

  it('skips a match that was completed again, or deleted, between the sweep read and the revert', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFired(['match_completed:m-1', 'match_completed:m-2']));
    vi.mocked(listUncompletedMatches).mockResolvedValue([open('m-1'), open('m-2')]);
    vi.mocked(getMatchById)
      .mockResolvedValueOnce({ id: 'm-1', status: 'completed' } as never)
      .mockResolvedValueOnce(null);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(revertMatchCompletion).not.toHaveBeenCalled();
    expect(summary.failures).toBe(0);
  });

  it('counts a revert that fails again and leaves it for the next run', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFired(['match_completed:m-1']));
    vi.mocked(listUncompletedMatches).mockResolvedValue([open('m-1', 'scheduled')]);
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', status: 'scheduled' } as never);
    vi.mocked(revertMatchCompletion).mockResolvedValue(false);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary.failures).toBe(1);
    expect(vi.mocked(logger.error).mock.calls.some(([, message]) => String(message).includes('match_reverted retry failed'))).toBe(true);
    // nothing applied, nothing stale: no reload
    expect(loadFreshKitContext).toHaveBeenCalledTimes(1);
  });

  it('does not count a revert the hook reports as stale (the format changed meanwhile): a warning, retried next run', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFired(['match_completed:m-1']));
    vi.mocked(listUncompletedMatches).mockResolvedValue([open('m-1', 'scheduled')]);
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', status: 'scheduled' } as never);
    vi.mocked(revertMatchCompletion).mockImplementation(async (input) => {
      if (input.report !== undefined) input.report.stale = true;
      return false;
    });
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary.failures).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn).mock.calls.some(([, message]) => String(message).includes('match_reverted retry skipped'))).toBe(true);
  });

  it('is bounded per league and per run', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `m-${String(i).padStart(2, '0')}`);
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFired(ids.map((id) => `match_completed:${id}`)));
    vi.mocked(listUncompletedMatches).mockResolvedValue(ids.map((id) => open(id)));
    vi.mocked(getMatchById).mockResolvedValue({ id: 'x', status: 'in_progress' } as never);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(revertMatchCompletion).toHaveBeenCalledTimes(FORMAT_CRON_REVERT_PER_LEAGUE);

    vi.mocked(revertMatchCompletion).mockClear();
    vi.mocked(listKitCronPhases).mockResolvedValue(['s-1', 's-2', 's-3'].map((id, i) => ({ ...cronPhase(), id: `t-${i}`, season_id: id })));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(revertMatchCompletion).toHaveBeenCalledTimes(FORMAT_CRON_REVERT_LIMIT);
  });

  it('scans at most one window of matches per league and run', async () => {
    const ids = Array.from({ length: FORMAT_CRON_REVERT_SCAN_LIMIT + 50 }, (_, i) => `m-${String(i).padStart(4, '0')}`);
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFired(ids.map((id) => `match_completed:${id}`)));
    await runFormatCronPass(AFTER_DEADLINE);
    const [, scanned] = vi.mocked(listUncompletedMatches).mock.calls[0];
    expect(scanned).toHaveLength(FORMAT_CRON_REVERT_SCAN_LIMIT);
  });
});

describe('pending match_reverted in completed or archived leagues', () => {
  const open = (id: string) => ({ id, tournament_id: PHASE, status: 'in_progress' });
  const withFired = (fired: string[]) => context(calendar([]), { firedEventKeys: fired });

  it('retries a failed revert of a match reopened after the season completed, and runs no calendar work there', async () => {
    vi.mocked(listKitCronPhases).mockResolvedValue([]);
    vi.mocked(listKitIdleSeasonIds).mockResolvedValue(['s-done']);
    vi.mocked(loadFreshKitContext).mockResolvedValue({ ...withFired(['match_completed:m-1']), seasonId: 's-done' });
    vi.mocked(listUncompletedMatches).mockResolvedValue([open('m-1')]);
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', status: 'in_progress' } as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(loadFreshKitContext).toHaveBeenCalledWith('s-done');
    expect(revertMatchCompletion).toHaveBeenCalledWith({ tournamentId: PHASE, matchId: 'm-1', report: { stale: false, failed: false } });
    // the state-derived repairs, no calendar work; the league is not a running one
    expect(fireLockedActionEvents).toHaveBeenCalledWith('s-done', null, expect.objectContaining({ context: expect.objectContaining({ seasonId: 's-done' }) }));
    expect(fireEvent).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ leagues: 0, failures: 0 });
  });

  it('repairs the pending events of a league that was completed with them missing: the lost lock, the match_completed and the round_end', async () => {
    vi.mocked(listKitCronPhases).mockResolvedValue([]);
    vi.mocked(listKitIdleSeasonIds).mockResolvedValue(['s-done']);
    vi.mocked(loadFreshKitContext).mockResolvedValue({ ...withFired([]), seasonId: 's-done' });
    vi.mocked(fireLockedActionEvents).mockResolvedValue(['action_locked:give_gifts']);
    vi.mocked(listFinalizedMatches).mockResolvedValue([
      { id: 'm-1', tournament_id: PHASE, round_id: 'r-1', player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1' },
    ] as never);
    vi.mocked(listRoundStatusesByTournamentIds).mockResolvedValue([{ id: 'r-1', tournament_id: PHASE, round_number: 1, status: 'completed' }]);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(onMatchCompleted).toHaveBeenCalledWith(expect.objectContaining({ matchId: 'm-1', tournament: expect.objectContaining({ season_id: 's-done' }) }));
    expect(onRoundCompleted).toHaveBeenCalledWith(expect.objectContaining({ roundId: 'r-1', tournament: expect.objectContaining({ season_id: 's-done' }) }));
    expect(summary).toMatchObject({ completions_backfilled: 1, leagues: 0, failures: 0 });
    // no calendar work: no mark, no policy
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('scans every currently-completed match of a completed league, not a slot-keyed window, so no part of a large league is skipped', async () => {
    // 1000 candidates: slot * 500 % 1000 is the same offset at every visit of a league that is only visited on one slot parity
    const ids = Array.from({ length: FORMAT_CRON_REVERT_SCAN_LIMIT * 2 }, (_, i) => `m-${String(i).padStart(4, '0')}`);
    vi.mocked(listKitCronPhases).mockResolvedValue([]);
    vi.mocked(listKitIdleSeasonIds).mockResolvedValue(['s-done']);
    vi.mocked(loadFreshKitContext).mockResolvedValue({ ...withFired(ids.map((id) => `match_completed:${id}`)), seasonId: 's-done' });
    for (const slot of [7000, 7002, 7004]) {
      vi.mocked(listUncompletedMatches).mockClear();
      await runFormatCronPass(new Date(slot * 15 * 60_000));
      const [, scanned] = vi.mocked(listUncompletedMatches).mock.calls[0];
      expect([...scanned].sort()).toEqual(ids);
    }
  });

  it('counts a revert that fails again, and the next run retries it', async () => {
    vi.mocked(listKitCronPhases).mockResolvedValue([]);
    vi.mocked(listKitIdleSeasonIds).mockResolvedValue(['s-done']);
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFired(['match_completed:m-1']));
    vi.mocked(listUncompletedMatches).mockResolvedValue([open('m-1')]);
    vi.mocked(getMatchById).mockResolvedValue({ id: 'm-1', status: 'in_progress' } as never);
    vi.mocked(revertMatchCompletion).mockResolvedValue(false);
    expect((await runFormatCronPass(AFTER_DEADLINE)).failures).toBe(1);
    expect((await runFormatCronPass(AFTER_DEADLINE)).failures).toBe(1);
    expect(revertMatchCompletion).toHaveBeenCalledTimes(2);
  });

  it('visits the running leagues first and shares their revert budget', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `m-${String(i).padStart(2, '0')}`);
    vi.mocked(listKitIdleSeasonIds).mockResolvedValue(['s-done']);
    vi.mocked(loadFreshKitContext).mockResolvedValue(withFired(ids.map((id) => `match_completed:${id}`)));
    vi.mocked(listUncompletedMatches).mockResolvedValue(ids.map((id) => open(id)));
    vi.mocked(getMatchById).mockResolvedValue({ id: 'x', status: 'in_progress' } as never);
    vi.mocked(listKitCronPhases).mockResolvedValue(['s-1', 's-2'].map((id, i) => ({ ...cronPhase(), id: `t-${i}`, season_id: id })));
    await runFormatCronPass(AFTER_DEADLINE);
    // 2 running leagues take 10 each; the idle one only gets what is left of the run's 25
    expect(revertMatchCompletion).toHaveBeenCalledTimes(FORMAT_CRON_REVERT_LIMIT);
    const visited = vi.mocked(loadFreshKitContext).mock.calls.map(([id]) => id);
    expect(visited.indexOf('s-done')).toBeGreaterThanOrEqual(2);
    expect(visited.lastIndexOf('s-2')).toBeLessThan(visited.indexOf('s-done'));

    // with three running leagues the revert budget is spent before the idle one is reached: it is visited for the repairs
    // that have budget left, and reverts nothing more
    vi.mocked(loadFreshKitContext).mockClear();
    vi.mocked(revertMatchCompletion).mockClear();
    vi.mocked(listKitCronPhases).mockResolvedValue(['s-1', 's-2', 's-3'].map((id, i) => ({ ...cronPhase(), id: `t-${i}`, season_id: id })));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(revertMatchCompletion).toHaveBeenCalledTimes(FORMAT_CRON_REVERT_LIMIT);
  });

  it('checks a bounded window of them per run that moves on, so every one is reached', async () => {
    const total = FORMAT_CRON_IDLE_LEAGUE_LIMIT * 3 + 4;
    vi.mocked(listKitCronPhases).mockResolvedValue([]);
    vi.mocked(listKitIdleSeasonIds).mockResolvedValue(Array.from({ length: total }, (_, i) => `s-${String(i).padStart(3, '0')}`));
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    const seen = new Set<string>();
    for (let n = 0; n < 4; n += 1) {
      vi.mocked(loadFreshKitContext).mockClear();
      await runFormatCronPass(new Date((7000 + n) * 15 * 60_000));
      expect(loadFreshKitContext).toHaveBeenCalledTimes(FORMAT_CRON_IDLE_LEAGUE_LIMIT);
      for (const [id] of vi.mocked(loadFreshKitContext).mock.calls) seen.add(id);
    }
    expect(seen.size).toBe(total);
  });

  it('never visits a running league as an idle one, and starts none once the time budget is used up', async () => {
    vi.mocked(listKitSeasonIds).mockResolvedValue([SEASON]);
    vi.mocked(listKitIdleSeasonIds).mockResolvedValue([SEASON, 's-done']);
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(loadFreshKitContext).mock.calls.map(([id]) => id)).toEqual([SEASON, 's-done']);

    vi.mocked(loadFreshKitContext).mockClear();
    let time = 0;
    await runFormatCronPass(AFTER_DEADLINE, {
      budgetMs: 1000,
      clock: () => {
        time += 600;
        return time;
      },
    });
    expect(vi.mocked(loadFreshKitContext).mock.calls.map(([id]) => id)).not.toContain('s-done');
  });

  it('counts a failing listing or a failing league without stopping the pass', async () => {
    vi.mocked(listKitCronPhases).mockResolvedValue([]);
    vi.mocked(listKitIdleSeasonIds).mockRejectedValueOnce(new Error('db'));
    expect((await runFormatCronPass(AFTER_DEADLINE)).failures).toBe(1);

    vi.mocked(listKitIdleSeasonIds).mockResolvedValue(['s-a', 's-b']);
    vi.mocked(loadFreshKitContext).mockRejectedValueOnce(new Error('load')).mockResolvedValue(null);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary.failures).toBe(1);
    expect(vi.mocked(loadFreshKitContext).mock.calls.map(([id]) => id)).toEqual(['s-a', 's-b']);
    expect(expireChallenges).toHaveBeenCalled();
  });
});

describe('policy reloads', () => {
  it('does not reload the context after policies that applied nothing', async () => {
    const policies: DeadlinePolicy[] = [
      { applies: 'match', offset_hours: 0, on_miss: 'admin_review' },
      { applies: 'match', offset_hours: -12, on_miss: 'admin_review' },
      { applies: 'match', offset_hours: -24, on_miss: 'admin_review' },
    ];
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar(policies)));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(loadFreshKitContext).toHaveBeenCalledTimes(1);
  });

  it('reloads after a policy that opened a check, and after one that threw', async () => {
    const policies: DeadlinePolicy[] = [
      { applies: 'match', offset_hours: 0, on_miss: 'admin_review' },
      { applies: 'match', offset_hours: -12, on_miss: 'admin_review' },
    ];
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar(policies)));
    await runFormatCronPass(AFTER_DEADLINE);
    // one load at the start, one after each policy (the first opened a check, the second a check under its own key)
    expect(loadFreshKitContext).toHaveBeenCalledTimes(3);

    vi.mocked(loadFreshKitContext).mockClear();
    vi.mocked(getRoundsByTournament).mockRejectedValue(new Error('db'));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary.failures).toBe(2);
    expect(loadFreshKitContext).toHaveBeenCalledTimes(3);
  });
});

describe('league window and time budget', () => {
  const phases = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ ...cronPhase(), id: `t-${i}`, season_id: `s-${String(i).padStart(3, '0')}` }));

  it('takes every league of a small list from the start', () => {
    expect(cronWindowStart(AFTER_DEADLINE, FORMAT_CRON_LEAGUE_LIMIT)).toBe(0);
    expect(cronWindowStart(AFTER_DEADLINE, 3)).toBe(0);
  });

  it('moves the window on by one limit per 15-minute slot and wraps around', () => {
    const slot = (n: number) => new Date(n * 15 * 60_000);
    const total = 250;
    const starts = [0, 1, 2, 3].map((n) => cronWindowStart(slot(1000 + n), total));
    expect(starts[1] - starts[0] === FORMAT_CRON_LEAGUE_LIMIT || starts[1] === (starts[0] + FORMAT_CRON_LEAGUE_LIMIT) % total).toBe(true);
    expect(starts.every((start) => start >= 0 && start < total)).toBe(true);
    // Every league is reached within a few runs: the union of the windows of consecutive slots covers the list.
    const covered = new Set<number>();
    for (let n = 0; n < 3; n += 1) {
      const start = cronWindowStart(slot(2000 + n), total);
      for (let i = 0; i < FORMAT_CRON_LEAGUE_LIMIT; i += 1) covered.add((start + i) % total);
    }
    expect(covered.size).toBe(total);
  });

  it('runs one window of leagues and reports the rest as deferred; no league starves', async () => {
    const total = 150;
    vi.mocked(listKitCronPhases).mockResolvedValue(phases(total));
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    const seen = new Set<string>();
    for (let n = 0; n < 3; n += 1) {
      vi.mocked(loadFreshKitContext).mockClear();
      const summary = await runFormatCronPass(new Date((5000 + n) * 15 * 60_000));
      expect(summary).toMatchObject({ leagues: FORMAT_CRON_LEAGUE_LIMIT, deferred: total - FORMAT_CRON_LEAGUE_LIMIT });
      for (const call of vi.mocked(loadFreshKitContext).mock.calls) seen.add(call[0]);
    }
    expect(seen.size).toBe(total);
  });

  it('starts no further league once the wall-clock budget is used up', async () => {
    vi.mocked(listKitCronPhases).mockResolvedValue(phases(5));
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    let time = 0;
    const summary = await runFormatCronPass(AFTER_DEADLINE, {
      budgetMs: 1000,
      clock: () => {
        time += 400;
        return time;
      },
    });
    expect(summary.leagues).toBeGreaterThan(0);
    expect(summary.leagues).toBeLessThan(5);
    expect(summary.leagues + summary.deferred).toBe(5);
    expect(logger.warn).toHaveBeenCalledWith('format-engine/cron', expect.stringContaining('time budget'), expect.anything());
  });
});

describe('a pass', () => {
  it('goes on after a league fails, logs the original error and still expires challenges', async () => {
    const boom = new Error('db down');
    vi.mocked(listKitCronPhases).mockResolvedValue([cronPhase(), { ...cronPhase(), id: 't-2', season_id: 's-2' }]);
    vi.mocked(loadFreshKitContext).mockImplementation(async (seasonId: string) => {
      if (seasonId === SEASON) throw boom;
      return null;
    });
    vi.mocked(expireChallenges).mockResolvedValue(3);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary).toMatchObject({ leagues: 2, failures: 1, challenges_expired: 3 });
    expect(logger.error).toHaveBeenCalledWith('format-engine/cron', 'league cron pass failed', expect.objectContaining({ seasonId: SEASON, error: boom }));
  });

  it('treats a time event refused as stale as retry-later: a warning, no failure, and the next league still runs', async () => {
    const marks = [{ key: 'kickoff', round: 1, offset_hours: 0 }];
    vi.mocked(listKitCronPhases).mockResolvedValue([cronPhase(), { ...cronPhase(), id: 't-2', season_id: 's-2' }]);
    vi.mocked(loadFreshKitContext).mockImplementation(async (seasonId: string) => (seasonId === SEASON ? context(calendar([], marks)) : null));
    // An admin replaced the format after the pass loaded it: the database refused the event before it logged the key.
    vi.mocked(fireEvent).mockRejectedValue(new FormatRuntimeError('format_context_stale'));
    const summary = await runFormatCronPass(BEFORE_DEADLINE);
    expect(summary).toMatchObject({ leagues: 2, failures: 0, marks: 0 });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('format-engine/cron', expect.stringContaining('format changed during the pass'), { seasonId: SEASON });
    // The next pass plans the same event again against the current format.
    vi.mocked(fireEvent).mockResolvedValue(FIRED as never);
    const next = await runFormatCronPass(BEFORE_DEADLINE);
    expect(next.marks).toBe(1);
  });

  it('counts a failing challenge sweep', async () => {
    vi.mocked(listKitCronPhases).mockResolvedValue([]);
    vi.mocked(expireChallenges).mockRejectedValue(new Error('rpc'));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary.failures).toBe(1);
  });
});

describe('round_end backfill', () => {
  const roundRow = (id: string, round_number: number, status: 'pending' | 'active' | 'completed' = 'completed', tournament_id = PHASE) => ({ id, tournament_id, round_number, status });

  it('fires the event of a completed round whose hook never applied, once the match backfill had its turn', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    vi.mocked(listRoundStatusesByTournamentIds).mockResolvedValue([roundRow('r-1', 1), roundRow('r-2', 2, 'active')]);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(listRoundStatusesByTournamentIds).toHaveBeenCalledWith([PHASE]);
    expect(vi.mocked(onRoundCompleted).mock.calls.map(([call]) => [call.tournament, call.roundId])).toEqual([
      [{ id: PHASE, season_id: SEASON, season_format_type: 'custom' }, 'r-1'],
    ]);
    // the hook fired an event: the context is reloaded
    expect(loadFreshKitContext).toHaveBeenCalledTimes(2);
  });

  it('leaves a round alone whose event fired, and reads no hook for a league without completed rounds', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([]), { firedEventKeys: ['round_end:swiss:1'] }));
    vi.mocked(listRoundStatusesByTournamentIds).mockResolvedValue([roundRow('r-1', 1)]);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(onRoundCompleted).not.toHaveBeenCalled();
    expect(loadFreshKitContext).toHaveBeenCalledTimes(1);
  });

  it('is bounded per league and per run', async () => {
    const many = Array.from({ length: 40 }, (_, i) => roundRow(`r-${i}`, i + 1));
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    vi.mocked(listRoundStatusesByTournamentIds).mockResolvedValue(many);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(onRoundCompleted).toHaveBeenCalledTimes(FORMAT_CRON_ROUND_END_PER_LEAGUE);

    vi.mocked(onRoundCompleted).mockClear();
    vi.mocked(listKitCronPhases).mockResolvedValue(['s-1', 's-2', 's-3'].map((id, i) => ({ ...cronPhase(), id: `t-${i}`, season_id: id })));
    vi.mocked(listRoundStatusesByTournamentIds).mockImplementation(async (ids) => many.map((row) => ({ ...row, tournament_id: ids[0] })));
    vi.mocked(loadFreshKitContext).mockImplementation(async (seasonId) => {
      const base = context(calendar([]));
      return { ...base, seasonId, phases: [{ ...base.phases[0], id: `t-${['s-1', 's-2', 's-3'].indexOf(seasonId)}` }] };
    });
    await runFormatCronPass(AFTER_DEADLINE);
    expect(onRoundCompleted).toHaveBeenCalledTimes(FORMAT_CRON_ROUND_END_LIMIT);
  });

  it('counts a failed hook and tries it again next run; a stale format or a deferral is no failure', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([])));
    vi.mocked(listRoundStatusesByTournamentIds).mockResolvedValue([roundRow('r-1', 1)]);
    vi.mocked(onRoundCompleted).mockImplementation(async (input) => {
      if (input.report !== undefined) input.report.failed = true;
      return false;
    });
    expect(await runFormatCronPass(AFTER_DEADLINE)).toMatchObject({ failures: 1 });

    vi.mocked(onRoundCompleted).mockImplementation(async (input) => {
      if (input.report !== undefined) input.report.stale = true;
      return false;
    });
    expect(await runFormatCronPass(AFTER_DEADLINE)).toMatchObject({ failures: 0 });
    expect(vi.mocked(logger.warn).mock.calls.some(([, message]) => String(message).includes('round_end backfill skipped'))).toBe(true);

    // deferred behind a missing match_completed: false with nothing set in the report
    vi.mocked(onRoundCompleted).mockResolvedValue(false);
    expect(await runFormatCronPass(AFTER_DEADLINE)).toMatchObject({ failures: 0 });
  });

  it('reads one round per stage and number for a stage that repeats per group', async () => {
    const base = context(calendar([]));
    const groups = { ...base, phases: [{ ...base.phases[0], id: 't-1' }, { ...base.phases[0], id: 't-2' }] };
    vi.mocked(loadFreshKitContext).mockResolvedValue(groups);
    vi.mocked(listRoundStatusesByTournamentIds).mockResolvedValue([roundRow('a-1', 1, 'completed', 't-1'), roundRow('b-1', 1, 'completed', 't-2')]);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(onRoundCompleted).toHaveBeenCalledTimes(1);
  });
});
