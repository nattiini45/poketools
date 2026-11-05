import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYERS, SEED, giftDef, stateFor } from './helpers';

vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  loadFreshKitContext: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/fire', () => ({ fireEvent: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/checks-server', () => ({ openChecks: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-table', () => ({ loadStageTable: vi.fn(), playerRowsOf: vi.fn(() => ({})) }));
vi.mock('@/lib/supabase/queries/match-outcomes', () => ({ getMatchOutcome: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-end-server', () => ({ checkStageEnd: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/phase-complete', () => ({ completePhaseAtStageEnd: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { checkStageEnd } from '../stage-end-server';
import { completePhaseAtStageEnd } from '../phase-complete';
import { fireEvent } from '../fire';
import { openChecks } from '../checks-server';
import { loadFreshKitContext, type KitContext } from '../load';
import { loadStageTable } from '../stage-table';
import { getMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { logger } from '@/lib/logger';
import { isKitCandidate, onMatchCompleted, onMatchUnresolved, onPhaseStatusChanged, onRoundGenerated } from '../hooks';

const def = giftDef();
const stage = def.stages[0];
const TOURNAMENT = { id: 't-1', season_id: 's-1', season_format_type: 'custom' as const };

function context(over: Partial<KitContext> = {}): KitContext {
  return {
    seasonId: 's-1',
    seed: SEED,
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
    expect(openChecks).toHaveBeenCalledWith('s-1', [expect.objectContaining({ dedupe_key: 'unresolved:m-1' })]);
  });

  it('never fails the caller; the original error is logged', async () => {
    const boom = new Error('db down');
    vi.mocked(fireEvent).mockRejectedValue(boom);
    await expect(onMatchCompleted(input)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('match completed'), expect.objectContaining({ error: boom, matchId: 'm-1' }));
  });
});

describe('onMatchUnresolved', () => {
  it('opens the unresolved check', async () => {
    await onMatchUnresolved({ tournament: TOURNAMENT, matchId: 'm-9', player1Id: 'p1', player2Id: 'p2' });
    expect(openChecks).toHaveBeenCalledWith('s-1', [expect.objectContaining({ dedupe_key: 'unresolved:m-9', source: 'unresolved_outcome' })]);
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
});

describe('onPhaseStatusChanged', () => {
  it('fires stage_start when a phase goes active', async () => {
    await onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'upcoming', to: 'active' });
    expect(vi.mocked(fireEvent).mock.calls.map((c) => c[1])).toEqual([{ event: 'stage_start', stage: 'main' }]);
  });

  it('ignores other moves', async () => {
    await onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'active', to: 'upcoming' });
    await onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'completed', to: 'completed' });
    expect(fireEvent).not.toHaveBeenCalled();
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
    await expect(onPhaseStatusChanged({ tournament: TOURNAMENT, from: 'upcoming', to: 'active' })).resolves.toBeUndefined();
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

  it('never fails the caller when completing the phase throws', async () => {
    const boom = new Error('db down');
    vi.mocked(loadFreshKitContext).mockResolvedValue(withEnd());
    vi.mocked(checkStageEnd).mockResolvedValue({ met: true, facts, openInRound: 0 });
    vi.mocked(completePhaseAtStageEnd).mockRejectedValue(boom);
    await expect(onMatchCompleted(input)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('format-engine/hooks', expect.stringContaining('stage end'), expect.objectContaining({ error: boom }));
  });
});