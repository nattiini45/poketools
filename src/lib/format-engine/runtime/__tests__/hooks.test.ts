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
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-end-server', () => ({ checkStageEnd: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/phase-complete', () => ({ completePhaseAtStageEnd: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/format-runtime')>()),
  fireFormatEvent: vi.fn(),
  getFormatRuntime: vi.fn(),
}));

import { checkStageEnd } from '../stage-end-server';
import { completePhaseAtStageEnd } from '../phase-complete';
import { fireEvent } from '../fire';
import { openChecks, resolveCheck } from '../checks-server';
import { auditMatchTeams } from '../team-audit-server';
import { loadFreshKitContext, type KitContext } from '../load';
import { loadStageTable } from '../stage-table';
import { getMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { logger } from '@/lib/logger';
import { fireFormatEvent, FormatRuntimeError, getFormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { expireSeasonReads } from '@/lib/revalidation';
import {
  inverseOps,
  isKitCandidate,
  onMatchCompleted,
  onMatchReverted,
  onMatchUnresolved,
  onPhaseStatusChanged,
  onRoundGenerated,
} from '../hooks';
import { isStaleOnly, newHookReport } from '../stale';

const def = giftDef();
const stage = def.stages[0];
const TOURNAMENT = { id: 't-1', season_id: 's-1', season_format_type: 'custom' as const };

function context(over: Partial<KitContext> = {}): KitContext {
  return {
    seasonId: 's-1',
    seed: SEED,
    revision: 1,
    def,
    state: stateFor(def),
    tunableIssues: [],
    phases: [{ id: 't-1', stage, members: PLAYERS }],
    ...over,
  };
}

const fired = { eventKey: 'x', fired: true, ops: [], notifications: [], issues: [], cascaded: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadFreshKitContext).mockResolvedValue(context());
  vi.mocked(fireEvent).mockResolvedValue(fired as never);
  vi.mocked(openChecks).mockResolvedValue([]);
  vi.mocked(resolveCheck).mockResolvedValue(true);
  vi.mocked(auditMatchTeams).mockResolvedValue({ opened: 0 });
  vi.mocked(getRoundById).mockResolvedValue({ id: 'r-1', round_number: 3 } as never);
  vi.mocked(getMatchOutcome).mockResolvedValue(null as never);
});

describe('isKitCandidate', () => {
  it('needs a season and a custom league', () => {
    expect(isKitCandidate(TOURNAMENT)).toBe(true);
    expect(isKitCandidate({ ...TOURNAMENT, season_id: null })).toBe(false);
    expect(isKitCandidate({ ...TOURNAMENT, season_format_type: 'swiss' as never })).toBe(false);
    expect(isKitCandidate({ id: 't', season_id: 's' })).toBe(false);
  });
});

describe('onMatchCompleted', () => {
  const input = { tournament: TOURNAMENT, matchId: 'm-1', roundId: 'r-1', player1Id: 'p1', player2Id: 'p2', winnerId: 'p1' };

  it('does nothing outside a custom league or a kit league', async () => {
    await onMatchCompleted({ ...input, tournament: { ...TOURNAMENT, season_format_type: null } });
    expect(loadFreshKitContext).not.toHaveBeenCalled();
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await onMatchCompleted(input);
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('fires match_completed with the track steps of both players', async () => {
    await onMatchCompleted(input);
    expect(fireEvent).toHaveBeenCalledTimes(1);
    const [seasonId, event, firedBy, options] = vi.mocked(fireEvent).mock.calls[0];
    expect(seasonId).toBe('s-1');
    expect(event).toMatchObject({ event: 'match_completed', stage: 'main', round: 3, match_id: 'm-1', players: ['p1', 'p2'] });
    expect(firedBy).toBeNull();
    expect(options?.ops).toEqual([{ op: 'set_track', track: 'milestones', player_id: 'p1', step: 1 }]);
  });

  it('opens an unresolved check for an unresolved outcome', async () => {
    vi.mocked(getMatchOutcome).mockResolvedValue({ kind: 'unresolved' } as never);
    await onMatchCompleted(input);
    expect(openChecks).toHaveBeenCalledWith('s-1', [expect.objectContaining({ dedupe_key: 'unresolved:m-1:0' })]);
  });

  it('keys the match-level checks by the completion generation', async () => {
    const matchDef = {
      ...def,
      rules: [
        ...def.rules,
        { kind: 'check.assisted' as const, id: 'won_it', source: { kind: 'expr' as const, of: 'match' as const, when: { k: 'ref' as const, name: 'won', t: 'boolean' as const } } },
      ],
    };
    vi.mocked(getMatchOutcome).mockResolvedValue({ kind: 'unresolved' } as never);
    vi.mocked(loadFreshKitContext).mockResolvedValue(
      context({ def: matchDef, state: stateFor(matchDef, { firedEventKeys: ['match_completed:m-1', 'match_reverted:m-1:1'] }) }),
    );
    await onMatchCompleted(input);
    expect(vi.mocked(openChecks).mock.calls[0][1].map((check) => check.dedupe_key)).toEqual(['unresolved:m-1:1', 'expr:won_it:m-1:1']);
  });

  it('never throws into the caller, reports the failure, and logs the original error', async () => {
    const boom = new Error('db down');
    vi.mocked(fireEvent).mockRejectedValue(boom);
    await expect(onMatchCompleted(input)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('match completed'), expect.objectContaining({ error: boom, matchId: 'm-1' }));
  });

  it('reports a stale format as a failed step (the heal plans it again), as a warning and not as an error', async () => {
    vi.mocked(fireEvent).mockRejectedValue(new FormatRuntimeError('format_context_stale'));
    await expect(onMatchCompleted(input)).resolves.toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('the format changed meanwhile'), expect.objectContaining({ matchId: 'm-1' }));
  });

  it('tells a stale format from a failure in the report a caller hands in (the cron counts only the failure)', async () => {
    vi.mocked(fireEvent).mockRejectedValue(new FormatRuntimeError('format_context_stale'));
    const stale = newHookReport();
    await expect(onMatchCompleted({ ...input, report: stale })).resolves.toBe(false);
    expect(stale).toEqual({ stale: true, failed: false });
    expect(isStaleOnly(stale)).toBe(true);

    vi.mocked(fireEvent).mockRejectedValue(new Error('db down'));
    const failed = newHookReport();
    await expect(onMatchCompleted({ ...input, report: failed })).resolves.toBe(false);
    expect(failed).toEqual({ stale: false, failed: true });
    expect(isStaleOnly(failed)).toBe(false);

    vi.mocked(fireEvent).mockResolvedValue(fired as never);
    const ok = newHookReport();
    await expect(onMatchCompleted({ ...input, report: ok })).resolves.toBe(true);
    expect(ok).toEqual({ stale: false, failed: false });
  });

  it('reports true when it applied, and when there is nothing to apply', async () => {
    await expect(onMatchCompleted(input)).resolves.toBe(true);
    await expect(onMatchCompleted({ ...input, tournament: { ...TOURNAMENT, season_format_type: null } })).resolves.toBe(true);
  });

  it('fires a new event for a completion after a revert', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(
      context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1', 'match_reverted:m-1:1'] }) }),
    );
    await onMatchCompleted(input);
    expect(vi.mocked(fireEvent).mock.calls[0][1]).toMatchObject({ event: 'match_completed', match_id: 'm-1:1' });

    vi.mocked(loadFreshKitContext).mockResolvedValue(
      context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1', 'match_reverted:m-1:1', 'match_completed:m-1:1', 'match_reverted:m-1:2', 'match_reverted:m-2:1'] }) }),
    );
    await onMatchCompleted(input);
    expect(vi.mocked(fireEvent).mock.calls[1][1]).toMatchObject({ match_id: 'm-1:2' });
  });
});

describe('onMatchCompleted: team audit', () => {
  const input = { tournament: TOURNAMENT, matchId: 'm-1', roundId: 'r-1', player1Id: 'p1', player2Id: 'p2', winnerId: 'p1' };

  it('audits the teams once with the context loaded before the event fired', async () => {
    const loaded = context();
    vi.mocked(loadFreshKitContext).mockResolvedValue(loaded);
    await expect(onMatchCompleted(input)).resolves.toBe(true);
    expect(auditMatchTeams).toHaveBeenCalledTimes(1);
    expect(auditMatchTeams).toHaveBeenCalledWith({
      tournament: TOURNAMENT,
      matchId: 'm-1',
      roundId: 'r-1',
      player1Id: 'p1',
      player2Id: 'p2',
      generation: 0,
      context: loaded,
    });
  });

  it('hands the audit retry policy of the caller to the audit', async () => {
    await onMatchCompleted({ ...input, auditRetry: 'never' });
    expect(vi.mocked(auditMatchTeams).mock.calls[0][0].retry).toBe('never');
  });

  it('passes the completion generation: after a match_reverted:<id>:1 key it is 1', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(
      context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1', 'match_reverted:m-1:1', 'match_reverted:m-2:1'] }) }),
    );
    await onMatchCompleted(input);
    expect(vi.mocked(auditMatchTeams).mock.calls[0][0].generation).toBe(1);
  });

  it('does not audit outside a kit league or when the phase is unknown', async () => {
    await onMatchCompleted({ ...input, tournament: { ...TOURNAMENT, season_format_type: null } });
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await onMatchCompleted(input);
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ phases: [] }));
    await onMatchCompleted(input);
    expect(auditMatchTeams).not.toHaveBeenCalled();
  });

  it('logs a failing audit, resolves false, and still fired the event and opened the checks', async () => {
    const boom = new Error('teams down');
    vi.mocked(auditMatchTeams).mockRejectedValue(boom);
    vi.mocked(getMatchOutcome).mockResolvedValue({ kind: 'unresolved' } as never);
    await expect(onMatchCompleted(input)).resolves.toBe(false);
    expect(fireEvent).toHaveBeenCalledTimes(1);
    expect(openChecks).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('team audit'), expect.objectContaining({ error: boom, matchId: 'm-1' }));
  });

  it('audits even when the match_completed fire failed', async () => {
    vi.mocked(fireEvent).mockRejectedValue(new Error('fire down'));
    await expect(onMatchCompleted(input)).resolves.toBe(false);
    expect(auditMatchTeams).toHaveBeenCalledTimes(1);
  });

  it('audits before the stage can end', async () => {
    const order: string[] = [];
    vi.mocked(auditMatchTeams).mockImplementation(async () => {
      order.push('audit');
      return { opened: 0 };
    });
    vi.mocked(checkStageEnd).mockImplementation(async () => {
      order.push('end');
      return null;
    });
    vi.mocked(loadFreshKitContext).mockResolvedValue(
      context({ phases: [{ id: 't-1', stage: { ...stage, end_when: { kind: 'rounds', rounds: 3 } }, members: PLAYERS }] }),
    );
    await onMatchCompleted(input);
    expect(order).toEqual(['audit', 'end']);
  });
});

describe('inverseOps', () => {
  it('revokes granted items and takes awarded points back; everything else is irreversible', () => {
    const logged = [
      { op: 'grant_item', resource: 'picks', player_id: 'p1', item_id: 'garchomp', amount: 1, exclusive: true, source: 'event', source_ref: null },
      { op: 'adjust_points', stage: 'main', player_id: 'p1', points: 3, reason: 'win bonus' },
      { op: 'set_track', track: 'milestones', player_id: 'p1', step: 1 },
      { op: 'set_flag', key: 'k', value: 1 },
      { op: 'revoke_item', resource: 'picks', player_id: 'p2', item_id: null, amount: 1 },
      { op: 'grant_item', resource: 'picks' },
      'junk',
    ];
    expect(inverseOps(logged as never)).toEqual({
      ops: [
        { op: 'revoke_item', resource: 'picks', player_id: 'p1', item_id: 'garchomp', amount: 1 },
        { op: 'adjust_points', stage: 'main', player_id: 'p1', points: -3, reason: 'reverted: win bonus' },
      ],
      irreversible: ['set_track', 'set_flag', 'revoke_item', 'grant_item'],
    });
  });

  it('keeps the reason within the 500 characters the table allows', () => {
    const [op] = inverseOps([{ op: 'adjust_points', stage: 'main', player_id: 'p1', points: 1, reason: 'x'.repeat(500) }] as never).ops;
    expect(op.op === 'adjust_points' && op.reason.length).toBe(500);
  });

  it('is empty for no log', () => {
    expect(inverseOps(undefined)).toEqual({ ops: [], irreversible: [] });
    expect(inverseOps({} as never)).toEqual({ ops: [], irreversible: [] });
  });
});

describe('onMatchReverted', () => {
  const input = { tournament: TOURNAMENT, matchId: 'm-1' };
  const logRow = (key: string, ops: unknown[]) => ({ event_key: key, ops });

  beforeEach(() => {
    vi.mocked(fireFormatEvent).mockResolvedValue(true);
  });

  it('does nothing outside a custom league', async () => {
    await expect(onMatchReverted({ ...input, tournament: { ...TOURNAMENT, season_format_type: null } })).resolves.toBe(true);
    expect(loadFreshKitContext).not.toHaveBeenCalled();
  });

  it('does nothing for a match that never fired match_completed', async () => {
    await expect(onMatchReverted(input)).resolves.toBe(true);
    expect(getFormatRuntime).not.toHaveBeenCalled();
    expect(fireFormatEvent).not.toHaveBeenCalled();
  });

  it('takes back the logged effects and logs match_reverted, which opens the next completion', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ revision: 7, state: stateFor(def, { firedEventKeys: ['match_completed:m-1'] }) }));
    vi.mocked(getFormatRuntime).mockResolvedValue({
      eventLog: [
        logRow('match_completed:m-1', [
          { op: 'grant_item', resource: 'picks', player_id: 'p1', item_id: 'garchomp', amount: 1, exclusive: false, source: 'event', source_ref: null },
          { op: 'set_track', track: 'milestones', player_id: 'p1', step: 1 },
        ]),
      ],
    } as never);

    await expect(onMatchReverted(input)).resolves.toBe(true);

    expect(fireFormatEvent).toHaveBeenCalledWith({
      seasonId: 's-1',
      eventKey: 'match_reverted:m-1:1',
      event: 'match_reverted',
      payload: { match_id: 'm-1', reverts: 'match_completed:m-1' },
      ops: [{ op: 'revoke_item', resource: 'picks', player_id: 'p1', item_id: 'garchomp', amount: 1 }],
      firedBy: null,
      // The revert is planned from the log of the format the context was loaded from: the database refuses it for another.
      revision: 7,
    });
    expect(expireSeasonReads).toHaveBeenCalledWith('s-1', ['t-1']);
    expect(logger.warn).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('cannot be taken back'), expect.objectContaining({ ops: ['set_track'] }));
  });

  it('reverts the latest completion of a match that was completed twice', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(
      context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1', 'match_reverted:m-1:1', 'match_completed:m-1:1'] }) }),
    );
    vi.mocked(getFormatRuntime).mockResolvedValue({
      eventLog: [
        logRow('match_completed:m-1', [{ op: 'adjust_points', stage: 'main', player_id: 'p2', points: 3, reason: 'old' }]),
        logRow('match_completed:m-1:1', [{ op: 'adjust_points', stage: 'main', player_id: 'p1', points: 3, reason: 'new' }]),
      ],
    } as never);

    await onMatchReverted(input);

    expect(fireFormatEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'match_reverted:m-1:2',
        ops: [{ op: 'adjust_points', stage: 'main', player_id: 'p1', points: -3, reason: 'reverted: new' }],
      }),
    );
  });

  it('is a no-op the second time (the completion it would revert has not fired again)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(
      context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1', 'match_reverted:m-1:1'] }) }),
    );
    await onMatchReverted(input);
    expect(fireFormatEvent).not.toHaveBeenCalled();
  });

  describe('per-match checks (unresolved outcome, match-level expression)', () => {
    const check = (id: string, source: 'unresolved_outcome' | 'expr', key: string, over: Record<string, unknown> = {}) => ({
      id,
      source,
      rule_id: 'r',
      dedupe_key: key,
      subject: {},
      status: 'open' as const,
      note: null,
      ...over,
    });

    it('rejects the open unresolved and match-level expression checks of the reverted completion only', async () => {
      const checks = [
        check('c-1', 'unresolved_outcome', 'unresolved:m-1:0'),
        check('c-2', 'expr', 'expr:hot:m-1:0'),
        check('c-3', 'unresolved_outcome', 'unresolved:m-1:1'),
        check('c-4', 'expr', 'expr:hot:m-1:11'),
        check('c-5', 'unresolved_outcome', 'unresolved:m-2:0'),
        check('c-6', 'expr', 'expr:vets:p1'),
        check('c-7', 'unresolved_outcome', 'unresolved:m-1:0', { status: 'confirmed' }),
      ];
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1'], checks: checks as never }) }));
      vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [logRow('match_completed:m-1', [])] } as never);

      await expect(onMatchReverted(input)).resolves.toBe(true);

      expect(vi.mocked(resolveCheck).mock.calls.map(([request]) => request.checkId)).toEqual(['c-1', 'c-2']);
      expect(fireFormatEvent).toHaveBeenCalledTimes(1);
    });

    it('closes the dispute of a match that never completed and advances the generation (a disputed match that is reopened)', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(
        context({ revision: 9, state: stateFor(def, { checks: [check('c-1', 'unresolved_outcome', 'unresolved:m-1:0')] as never }) }),
      );
      await expect(onMatchReverted(input)).resolves.toBe(true);
      expect(vi.mocked(resolveCheck).mock.calls.map(([request]) => request.checkId)).toEqual(['c-1']);
      expect(fireFormatEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'match_reverted:m-1:1', ops: [], revision: 9 }));
    });

    it('advances the generation when the dispute check was already decided, so the next tie opens a new one', async () => {
      const decided = [check('c-1', 'unresolved_outcome', 'unresolved:m-1:0', { status: 'confirmed' })];
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({ state: stateFor(def, { checks: decided as never }) }));
      await expect(onMatchReverted(input)).resolves.toBe(true);
      expect(resolveCheck).not.toHaveBeenCalled();
      const reverted = vi.mocked(fireFormatEvent).mock.calls[0][0].eventKey;
      expect(reverted).toBe('match_reverted:m-1:1');

      // The replay ties again: the dispute check reads the advanced generation, so its key is a new one.
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({ state: stateFor(def, { checks: decided as never, firedEventKeys: [reverted] }) }));
      await onMatchUnresolved({ tournament: TOURNAMENT, matchId: 'm-1', player1Id: 'p1', player2Id: 'p2' });
      expect(openChecks).toHaveBeenCalledWith('s-1', [expect.objectContaining({ dedupe_key: 'unresolved:m-1:1' })]);
    });

    it('does not fire the revert when a check cannot be closed, so the retry (the cron heal) finds the completion still fired', async () => {
      const boom = new Error('rpc down');
      vi.mocked(resolveCheck).mockRejectedValue(boom);
      vi.mocked(loadFreshKitContext).mockResolvedValue(
        context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1'], checks: [check('c-1', 'expr', 'expr:hot:m-1:0')] as never }) }),
      );
      vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [logRow('match_completed:m-1', [])] } as never);
      await expect(onMatchReverted(input)).resolves.toBe(false);
      expect(fireFormatEvent).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('match check close'), expect.objectContaining({ error: boom, checkId: 'c-1' }));
    });
  });

  describe('team audit checks', () => {
    const audit = (id: string, key: string, over: Record<string, unknown> = {}) => ({
      id,
      source: 'team_audit' as const,
      rule_id: 'team.audit',
      dedupe_key: key,
      subject: {},
      status: 'open' as const,
      note: null,
      ...over,
    });

    it('rejects the open audit checks of the reverted completion only', async () => {
      const checks = [
        audit('c-1', 'team_audit:m-1:0:p1'),
        audit('c-2', 'team_audit:m-1:0:p2'),
        audit('c-3', 'team_audit:m-1:1:p1'),
        audit('c-4', 'team_audit:m-2:0:p1'),
        audit('c-5', 'team_audit:m-1:0:p3', { status: 'confirmed' }),
        audit('c-6', 'team_audit:m-1:0:p4', { status: 'rejected' }),
        audit('c-7', 'deadline:main:0:m-1', { source: 'deadline_missed' }),
      ];
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1'], checks: checks as never }) }));
      vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [logRow('match_completed:m-1', [])] } as never);

      await expect(onMatchReverted(input)).resolves.toBe(true);

      expect(vi.mocked(resolveCheck).mock.calls.map(([request]) => request)).toEqual([
        { seasonId: 's-1', checkId: 'c-1', status: 'rejected', adminId: null, note: 'match_reset' },
        { seasonId: 's-1', checkId: 'c-2', status: 'rejected', adminId: null, note: 'match_reset' },
      ]);
      expect(fireFormatEvent).toHaveBeenCalledTimes(1);
    });

    it('closes them even when the completed key is absent (the fire failed, the audit succeeded), and advances the generation', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({ state: stateFor(def, { checks: [audit('c-1', 'team_audit:m-1:0:p1')] as never }) }));
      await expect(onMatchReverted(input)).resolves.toBe(true);
      expect(resolveCheck).toHaveBeenCalledTimes(1);
      // Nothing to take back (the event never fired), but the rejected check holds the key team_audit:m-1:0:p1.
      expect(getFormatRuntime).not.toHaveBeenCalled();
      expect(fireFormatEvent).toHaveBeenCalledTimes(1);
      expect(fireFormatEvent).toHaveBeenCalledWith(
        expect.objectContaining({ seasonId: 's-1', eventKey: 'match_reverted:m-1:1', event: 'match_reverted', ops: [], payload: { match_id: 'm-1', reverts: 'match_completed:m-1' } }),
      );
    });

    it('advances the generation when the audit check was already decided, and not for another match or generation', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({ state: stateFor(def, { checks: [audit('c-1', 'team_audit:m-1:0:p1', { status: 'confirmed' })] as never }) }));
      await expect(onMatchReverted(input)).resolves.toBe(true);
      expect(resolveCheck).not.toHaveBeenCalled();
      expect(fireFormatEvent).toHaveBeenCalledTimes(1);

      vi.mocked(fireFormatEvent).mockClear();
      const others = [audit('c-2', 'team_audit:m-2:0:p1'), audit('c-3', 'team_audit:m-1:1:p1')];
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({ state: stateFor(def, { checks: others as never }) }));
      await expect(onMatchReverted(input)).resolves.toBe(true);
      expect(fireFormatEvent).not.toHaveBeenCalled();
    });

    it('lets the next completion open its audit again: fire failed, audit succeeded, reopened, completed again', async () => {
      // 1. completion 0: the match_completed fire fails, the audit opens team_audit:m-1:0:p1.
      const completion = { tournament: TOURNAMENT, matchId: 'm-1', roundId: 'r-1', player1Id: 'p1', player2Id: 'p2', winnerId: 'p1' };
      vi.mocked(fireEvent).mockRejectedValueOnce(new Error('fire down'));
      await expect(onMatchCompleted(completion)).resolves.toBe(false);
      expect(vi.mocked(auditMatchTeams).mock.calls[0][0]).toMatchObject({ generation: 0 });

      // 2. the reopen: the check is rejected and the generation advances.
      const state = stateFor(def, { checks: [audit('c-1', 'team_audit:m-1:0:p1')] as never });
      vi.mocked(loadFreshKitContext).mockResolvedValue(context({ state }));
      await onMatchReverted(input);
      const reverted = vi.mocked(fireFormatEvent).mock.calls[0][0].eventKey;
      expect(reverted).toBe('match_reverted:m-1:1');

      // 3. the re-completion reads the advanced generation, so its audit key (team_audit:m-1:1:p1) is a new one.
      vi.mocked(loadFreshKitContext).mockResolvedValue(
        context({ state: stateFor(def, { checks: [audit('c-1', 'team_audit:m-1:0:p1', { status: 'rejected' })] as never, firedEventKeys: [reverted] }) }),
      );
      await onMatchCompleted(completion);
      expect(vi.mocked(auditMatchTeams).mock.calls[1][0]).toMatchObject({ generation: 1 });
      expect(vi.mocked(fireEvent).mock.calls[1][1]).toMatchObject({ match_id: 'm-1:1' });
    });

    it('reads the generation of the completion it reverts', async () => {
      const checks = [audit('c-old', 'team_audit:m-1:0:p1'), audit('c-new', 'team_audit:m-1:1:p1')];
      vi.mocked(loadFreshKitContext).mockResolvedValue(
        context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1', 'match_reverted:m-1:1', 'match_completed:m-1:1'], checks: checks as never }) }),
      );
      vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [logRow('match_completed:m-1:1', [])] } as never);
      await onMatchReverted(input);
      expect(vi.mocked(resolveCheck).mock.calls.map(([request]) => request.checkId)).toEqual(['c-new']);
    });

    it('does not advance the generation or revert when an audit check cannot be closed, and reports false', async () => {
      const boom = new Error('rpc down');
      vi.mocked(resolveCheck).mockRejectedValue(boom);
      vi.mocked(loadFreshKitContext).mockResolvedValue(
        context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1'], checks: [audit('c-1', 'team_audit:m-1:0:p1')] as never }) }),
      );
      vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [logRow('match_completed:m-1', [])] } as never);
      await expect(onMatchReverted(input)).resolves.toBe(false);
      // The completion key stays fired and the generation stays: the cron heal calls the revert again and closes what is left.
      expect(fireFormatEvent).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('match check close'), expect.objectContaining({ error: boom, checkId: 'c-1' }));

      // The retry: the lone check closes now, and the revert fires.
      vi.mocked(resolveCheck).mockResolvedValue(true);
      await expect(onMatchReverted(input)).resolves.toBe(true);
      expect(fireFormatEvent).toHaveBeenCalledTimes(1);
    });
  });

  it('reports false when the database refuses the revert as stale (the key stays free, the heal repeats it)', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1'] }) }));
    vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [logRow('match_completed:m-1', [])] } as never);
    vi.mocked(fireFormatEvent).mockRejectedValue(new FormatRuntimeError('format_context_stale'));
    await expect(onMatchReverted(input)).resolves.toBe(false);
    expect(expireSeasonReads).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('the format changed meanwhile'), expect.objectContaining({ matchId: 'm-1' }));
  });

  it('marks a stale revert in the report, and any other failure as failed', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context({ state: stateFor(def, { firedEventKeys: ['match_completed:m-1'] }) }));
    vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [logRow('match_completed:m-1', [])] } as never);
    vi.mocked(fireFormatEvent).mockRejectedValue(new FormatRuntimeError('format_context_stale'));
    const stale = newHookReport();
    await expect(onMatchReverted({ ...input, report: stale })).resolves.toBe(false);
    expect(isStaleOnly(stale)).toBe(true);

    vi.mocked(fireFormatEvent).mockRejectedValue(new Error('db down'));
    const failed = newHookReport();
    await expect(onMatchReverted({ ...input, report: failed })).resolves.toBe(false);
    expect(failed).toEqual({ stale: false, failed: true });
  });

  it('never throws into the caller; the original error is logged', async () => {
    const boom = new Error('db down');
    vi.mocked(loadFreshKitContext).mockRejectedValue(boom);
    await expect(onMatchReverted(input)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('match reverted'), expect.objectContaining({ error: boom, matchId: 'm-1' }));
  });
});

describe('onMatchUnresolved', () => {
  it('opens the unresolved check', async () => {
    await onMatchUnresolved({ tournament: TOURNAMENT, matchId: 'm-9', player1Id: 'p1', player2Id: 'p2' });
    expect(openChecks).toHaveBeenCalledWith('s-1', [expect.objectContaining({ dedupe_key: 'unresolved:m-9:0', source: 'unresolved_outcome' })]);
  });
});

describe('onRoundGenerated', () => {
  it('fires round_start and opens a rematch check only for rematches', async () => {
    await onRoundGenerated({ tournament: TOURNAMENT, roundNumber: 2, rematches: 0, startsPhase: false });
    expect(vi.mocked(fireEvent).mock.calls.map((c) => c[1])).toEqual([{ event: 'round_start', stage: 'main', round: 2 }]);
    expect(openChecks).not.toHaveBeenCalled();

    await onRoundGenerated({ tournament: TOURNAMENT, roundNumber: 3, rematches: 2, startsPhase: false });
    expect(openChecks).toHaveBeenCalledWith('s-1', [expect.objectContaining({ dedupe_key: 'rematch:main:3' })]);
  });

  it('fires stage_start before round_start for the first round', async () => {
    await onRoundGenerated({ tournament: TOURNAMENT, roundNumber: 1, rematches: 0, startsPhase: true });
    expect(vi.mocked(fireEvent).mock.calls.map((c) => c[1].event)).toEqual(['stage_start', 'round_start']);
  });

  it('retries a stage_start that failed once and then goes on to round_start', async () => {
    vi.mocked(fireEvent).mockRejectedValueOnce(new Error('db blip'));
    await onRoundGenerated({ tournament: TOURNAMENT, roundNumber: 1, rematches: 0, startsPhase: true });
    expect(vi.mocked(fireEvent).mock.calls.map((c) => c[1].event)).toEqual(['stage_start', 'stage_start', 'round_start']);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('stage_start did not apply'), expect.anything());
  });

  it('logs how to recover when stage_start fails twice, and still fires round_start', async () => {
    vi.mocked(fireEvent).mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('still down'));
    await expect(onRoundGenerated({ tournament: TOURNAMENT, roundNumber: 1, rematches: 0, startsPhase: true })).resolves.toBeUndefined();
    expect(vi.mocked(fireEvent).mock.calls.map((c) => c[1].event)).toEqual(['stage_start', 'stage_start', 'round_start']);
    expect(logger.error).toHaveBeenCalledWith(
      'format-engine/hooks',
      expect.stringContaining('stage_start did not apply for the first round'),
      expect.objectContaining({ tournamentId: 't-1', seasonId: 's-1' }),
    );
  });

  it('does not retry anything for a round that does not start the phase', async () => {
    vi.mocked(fireEvent).mockRejectedValue(new Error('down'));
    await onRoundGenerated({ tournament: TOURNAMENT, roundNumber: 2, rematches: 0, startsPhase: false });
    expect(vi.mocked(fireEvent)).toHaveBeenCalledTimes(1);
  });
});

describe('onPhaseStatusChanged', () => {
  it('fires stage_start when a phase goes active', async () => {
    await onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'upcoming', to: 'active' });
    expect(vi.mocked(fireEvent).mock.calls.map((c) => c[1])).toEqual([{ event: 'stage_start', stage: 'main' }]);
  });

  it('ignores other moves', async () => {
    await expect(onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'active', to: 'upcoming' })).resolves.toBe(true);
    await onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'completed', to: 'completed' });
    expect(fireEvent).not.toHaveBeenCalled();
  });

  it('resolves true when it applied and false, without throwing, when a step failed', async () => {
    vi.mocked(loadStageTable).mockResolvedValue([] as never);
    await expect(onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'active', to: 'completed' })).resolves.toBe(true);
    vi.mocked(fireEvent).mockRejectedValueOnce(new Error('fire down'));
    await expect(onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'active', to: 'completed' })).resolves.toBe(false);
    vi.mocked(loadStageTable).mockResolvedValue([
      { player_id: 'p1', needs_decision_match: true, tie_group: 1 },
      { player_id: 'p2', needs_decision_match: true, tie_group: 1 },
    ] as never);
    vi.mocked(openChecks).mockRejectedValueOnce(new Error('checks down'));
    await expect(onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'active', to: 'completed' })).resolves.toBe(false);
    await expect(onPhaseStatusChanged({ tournament: { ...TOURNAMENT, season_format_type: null }, from: 'active', to: 'completed' })).resolves.toBe(true);
  });

  it('fires stage_end on completion and opens a check per tied group', async () => {
    vi.mocked(loadStageTable).mockResolvedValue([
      { player_id: 'p1', needs_decision_match: true, tie_group: 1 },
      { player_id: 'p2', needs_decision_match: true, tie_group: 1 },
      { player_id: 'p3', needs_decision_match: false, tie_group: null },
    ] as never);
    await onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'active', to: 'completed' });
    expect(vi.mocked(fireEvent).mock.calls.map((c) => c[1])).toEqual([{ event: 'stage_end', stage: 'main' }]);
    expect(openChecks).toHaveBeenCalledWith('s-1', [expect.objectContaining({ dedupe_key: 'tie:main:p1,p2' })]);
  });

  describe('a stage that repeats per group', () => {
    const grouped = { ...stage, foreach_group: { from: 'groups' } };
    const groupCtx = () => context({ phases: [{ id: 't-1', stage: grouped, members: PLAYERS }, { id: 't-2', stage: grouped, members: PLAYERS }] });

    it('ends only with its last group phase', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(groupCtx());
      vi.mocked(getTournamentById).mockResolvedValue({ status: 'active' } as never);
      await onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'active', to: 'completed' });
      expect(fireEvent).not.toHaveBeenCalled();

      vi.mocked(getTournamentById).mockResolvedValue({ status: 'completed' } as never);
      await onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'active', to: 'completed' });
      expect(vi.mocked(fireEvent).mock.calls.map((c) => c[1])).toEqual([{ event: 'stage_end', stage: 'main' }]);
    });

    it('starts with its first group phase', async () => {
      vi.mocked(loadFreshKitContext).mockResolvedValue(groupCtx());
      await onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'upcoming', to: 'active' });
      expect(vi.mocked(fireEvent).mock.calls.map((c) => c[1])).toEqual([{ event: 'stage_start', stage: 'main' }]);
    });
  });

  it('never fails the caller', async () => {
    vi.mocked(loadFreshKitContext).mockRejectedValue(new Error('down'));
    await expect(onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'upcoming', to: 'active' })).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('onMatchCompleted: end_when', () => {
  const input = { tournament: TOURNAMENT, matchId: 'm-1', roundId: 'r-1', player1Id: 'p1', player2Id: 'p2', winnerId: 'p1' };
  const facts = { round: 3, rounds_played: 3, open_matches: 0, participants: 6 };
  const withEnd = () =>
    context({ phases: [{ id: 't-1', stage: { ...stage, end_when: { kind: 'rounds', rounds: 3 } }, members: PLAYERS }] });

  beforeEach(() => {
    vi.mocked(completePhaseAtStageEnd).mockResolvedValue('completed');
  });

  it('costs nothing for a stage without end_when', async () => {
    await onMatchCompleted(input);
    expect(checkStageEnd).not.toHaveBeenCalled();
    expect(completePhaseAtStageEnd).not.toHaveBeenCalled();
  });

  it('completes the phase when the condition holds and the round has no open match', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd());
    vi.mocked(checkStageEnd).mockResolvedValue({ met: true, facts, openInRound: 0 });
    await onMatchCompleted(input);
    expect(completePhaseAtStageEnd).toHaveBeenCalledWith('t-1', 'end_when:main');
  });

  it('waits while the round still has open matches or the condition is unmet', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd());
    vi.mocked(checkStageEnd).mockResolvedValue({ met: true, facts, openInRound: 1 });
    await onMatchCompleted(input);
    vi.mocked(checkStageEnd).mockResolvedValue({ met: false, facts, openInRound: 0 });
    await onMatchCompleted(input);
    expect(completePhaseAtStageEnd).not.toHaveBeenCalled();
  });

  it('warns and keeps the phase running when the expression cannot be evaluated', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd());
    vi.mocked(checkStageEnd).mockResolvedValue({ met: false, issue: 'expr_eval_failed', facts, openInRound: 0 });
    await onMatchCompleted(input);
    expect(completePhaseAtStageEnd).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('format-engine/hooks', 'end_when could not be evaluated', expect.objectContaining({ issue: 'expr_eval_failed' }));
  });

  it('never throws into the caller when completing the phase throws, and reports the failed step so the heal calls it again', async () => {
    const boom = new Error('db down');
    vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd());
    vi.mocked(checkStageEnd).mockResolvedValue({ met: true, facts, openInRound: 0 });
    vi.mocked(completePhaseAtStageEnd).mockRejectedValueOnce(boom);
    await expect(onMatchCompleted(input)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('stage end'), expect.objectContaining({ error: boom }));
    // the heal's re-run completes the phase and reports success
    await expect(onMatchCompleted(input)).resolves.toBe(true);
    expect(completePhaseAtStageEnd).toHaveBeenCalledTimes(2);
    expect(completePhaseAtStageEnd).toHaveBeenLastCalledWith('t-1', 'end_when:main');
  });

  it('reports a stage end whose reaction failed after the flip as a failed step, so the heal repeats the reaction', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd());
    vi.mocked(checkStageEnd).mockResolvedValue({ met: true, facts, openInRound: 0 });
    vi.mocked(completePhaseAtStageEnd).mockResolvedValueOnce('reaction_failed');
    await expect(onMatchCompleted(input)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('stage end'), expect.anything());
    // the heal's re-run finds the phase completed and repeats the reaction
    vi.mocked(completePhaseAtStageEnd).mockResolvedValueOnce('skipped');
    await expect(onMatchCompleted(input)).resolves.toBe(true);
    expect(completePhaseAtStageEnd).toHaveBeenCalledTimes(2);
  });

  it('evaluates the stage end over a context loaded after the match_completed event, not the one the hook started with', async () => {
    const started = withEnd();
    const afterEvent = { ...withEnd(), state: { ...withEnd().state, firedEventKeys: ['match_completed:m-1'] } };
    vi.mocked(loadFreshKitContext).mockResolvedValueOnce(started).mockResolvedValue(afterEvent);
    vi.mocked(checkStageEnd).mockResolvedValue({ met: false, facts, openInRound: 0 });
    await onMatchCompleted(input);
    expect(checkStageEnd).toHaveBeenCalledTimes(1);
    expect(vi.mocked(checkStageEnd).mock.calls[0][0]).toBe(afterEvent);
  });

  it('reports a failing end_when check the same way', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd());
    vi.mocked(checkStageEnd).mockRejectedValue(new Error('rounds read'));
    await expect(onMatchCompleted(input)).resolves.toBe(false);
  });
});