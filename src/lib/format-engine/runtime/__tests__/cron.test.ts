import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeadlinePolicy, StageCalendar } from '@/lib/format-kit/types';
import { PLAYERS, SEED, link, stateFor, wichtelDef } from './helpers';

vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  loadFreshKitContext: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/fire', () => ({ fireEvent: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/actions-server', () => ({ submitAction: vi.fn() }));
vi.mock('@/lib/format-engine/challenge-server', () => ({ expireChallenges: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-cron', () => ({ listKitCronPhases: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', () => ({ openFormatCheck: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchesByTournament: vi.fn(), updateMatchStatus: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/teams', () => ({ listTeamsByTournament: vi.fn() }));
vi.mock('@/lib/match/finalize', () => ({ finalizeMatchCompletion: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn(), revalidateMatchPages: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { expireChallenges } from '../../challenge-server';
import { submitAction } from '../actions-server';
import { runFormatCronPass } from '../cron';
import { fireEvent } from '../fire';
import { loadFreshKitContext, type KitContext } from '../load';
import { finalizeMatchCompletion } from '@/lib/match/finalize';
import { logAuditEvent } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import { listKitCronPhases } from '@/lib/supabase/queries/format-cron';
import { openFormatCheck } from '@/lib/supabase/queries/format-runtime';
import { getMatchesByTournament, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { listTeamsByTournament } from '@/lib/supabase/queries/teams';

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
  return { seasonId: SEASON, seed: SEED, def, state: stateFor(def, patch), tunableIssues: [], phases: [{ id: PHASE, stage, members: PLAYERS }] };
}

const cronPhase = (status = 'active') => ({ id: PHASE, season_id: SEASON, status, format_stage_key: 'swiss', season_start_date: '2026-06-01' });
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
  vi.mocked(fireEvent).mockResolvedValue(FIRED as never);
  vi.mocked(openFormatCheck).mockResolvedValue('check-1');
  vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r-1', round_number: 1, deadline: null }] as never);
  vi.mocked(getMatchesByTournament).mockResolvedValue([match()] as never);
  vi.mocked(listTeamsByTournament).mockResolvedValue([{ match_id: 'm-1', player_id: 'p1' }] as never);
  vi.mocked(updateMatchStatus).mockResolvedValue({ id: 'm-1' } as never);
  vi.mocked(finalizeMatchCompletion).mockResolvedValue({ finalized: true } as never);
  vi.mocked(expireChallenges).mockResolvedValue(0);
});

describe('time marks', () => {
  const marks = [{ key: 'kickoff', round: 1, offset_hours: 0 }, { key: 'late', round: 2, offset_hours: 0 }];

  it('fires the due marks once and never the ones not due yet', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([], marks)));
    const summary = await runFormatCronPass(BEFORE_DEADLINE);
    expect(vi.mocked(fireEvent).mock.calls.map((call) => call[1])).toEqual([{ event: 'time', stage: 'swiss', mark: 'kickoff' }]);
    expect(summary.marks).toBe(1);
  });

  it('skips a mark whose event key already fired', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([], marks), { firedEventKeys: ['time:kickoff'] }));
    const summary = await runFormatCronPass(BEFORE_DEADLINE);
    expect(fireEvent).not.toHaveBeenCalled();
    expect(summary.marks).toBe(0);
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
    expect(updateMatchStatus).not.toHaveBeenCalled();
    expect(openFormatCheck).not.toHaveBeenCalled();
  });

  it('forfeits the side without a team and finalizes with a system forfeit outcome', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(updateMatchStatus).toHaveBeenCalledWith('m-1', 'completed', 'p1', undefined, undefined, 'scheduled');
    const input = vi.mocked(finalizeMatchCompletion).mock.calls[0][0];
    expect(input.winnerId).toBe('p1');
    expect(input.previousStatus).toBe('scheduled');
    expect(input.adminOutcome).toMatchObject({ kind: 'forfeit', setBy: null });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actor_id: null, actor_name: 'System', metadata: expect.objectContaining({ loser_id: 'p2' }) }));
    expect(summary.forfeits).toBe(1);
  });

  it('stored round deadlines win over the calendar', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r-1', round_number: 1, deadline: '2026-06-20T00:00:00Z' }] as never);
    await runFormatCronPass(AFTER_DEADLINE);
    expect(updateMatchStatus).not.toHaveBeenCalled();
  });

  it('leaves a match that changed meanwhile alone (compare-and-set miss)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(updateMatchStatus).mockResolvedValue(null as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(finalizeMatchCompletion).not.toHaveBeenCalled();
    expect(summary.forfeits).toBe(0);
  });

  it('opens a check instead when both or neither side has a team', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([forfeit])));
    vi.mocked(listTeamsByTournament).mockResolvedValue([]);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(updateMatchStatus).not.toHaveBeenCalled();
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
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([lock]), { links, firedEventKeys: ['time:deadline:swiss:0'] }));
    await runFormatCronPass(AFTER_DEADLINE);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('admin_review opens a check per player without a submission', async () => {
    const review: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'admin_review' };
    const submitted = { id: 'sub', action: 'give_gifts', actor: 'p1', target: 'p2', status: 'submitted' as const, picks: [] };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([review]), { links, submissions: [submitted] }));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(openFormatCheck).mock.calls.map((call) => call[0].dedupeKey)).toEqual(['deadline:swiss:0:give_gifts:p3']);
    expect(summary.checks).toBe(1);
  });

  it('seeded_random_pick submits a valid pick for each player who has none', async () => {
    const pick: DeadlinePolicy = { applies: 'action', action: 'give_gifts', offset_hours: 0, on_miss: 'seeded_random_pick' };
    vi.mocked(loadFreshKitContext).mockResolvedValue(context(calendar([pick]), { links, flags: OPEN_FLAGS }));
    vi.mocked(submitAction).mockResolvedValue({ ok: true, submission: {} } as never);
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(vi.mocked(submitAction).mock.calls.map((call) => call[0])).toEqual([
      { seasonId: SEASON, actionId: 'give_gifts', actorId: 'p1', picks: [{ step: 0, item_id: 'garchomp' }] },
      { seasonId: SEASON, actionId: 'give_gifts', actorId: 'p3', picks: [{ step: 0, item_id: 'garchomp' }] },
    ]);
    expect(summary.picks).toBe(2);
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

  it('counts a failing challenge sweep', async () => {
    vi.mocked(listKitCronPhases).mockResolvedValue([]);
    vi.mocked(expireChallenges).mockRejectedValue(new Error('rpc'));
    const summary = await runFormatCronPass(AFTER_DEADLINE);
    expect(summary.failures).toBe(1);
  });
});
