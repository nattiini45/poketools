import { beforeEach, describe, expect, it, vi } from 'vitest';
import { giftDef, stateFor } from '@/lib/format-engine/runtime/__tests__/helpers';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({}));
vi.mock('@/lib/supabase/queries/matches', () => ({}));
vi.mock('@/lib/supabase/queries/rounds', () => ({}));
vi.mock('@/lib/supabase/queries/games', () => ({}));
vi.mock('@/lib/supabase/queries/ratings', () => ({}));
vi.mock('@/lib/supabase/queries/match-outcomes', () => ({}));
vi.mock('@/lib/format-engine/runtime/team-audit-server', () => ({}));
vi.mock('@/lib/format-engine/runtime/load', async (original) => ({ ...await original<typeof import('@/lib/format-engine/runtime/load')>(), loadFreshKitContext: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/checks-server', () => ({ openChecks: vi.fn(), resolveCheck: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', () => ({ firePhaseFormatMatchEvent: vi.fn(), getFormatRuntime: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ completePhaseIfActive: vi.fn(), getPhaseById: vi.fn(), getPhasesBySeasonId: vi.fn(), getPhaseParticipantsBatch: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getPhaseRoundById: vi.fn(), getRoundsByPhase: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-match-outcomes', () => ({ getPhaseMatchOutcome: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-groups', () => ({ getGroupsByPhase: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-format-runtime', () => ({
  getNativeKitOutcomes: vi.fn(), getNativeKitMatchIds: vi.fn(), getNativeKitGameCounts: vi.fn(), getNativeKitKills: vi.fn(),
  getNativeKitCompletedRecords: vi.fn(), getNativeKitMatchFacts: vi.fn(),
}));

import { createNativeKitMatchEffects } from '../kit-match-effects';
import { loadFreshKitContext, type KitContext } from '@/lib/format-engine/runtime/load';
import { openChecks, resolveCheck } from '@/lib/format-engine/runtime/checks-server';
import { firePhaseFormatMatchEvent, getFormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { completePhaseIfActive, getPhaseById, getPhasesBySeasonId, getPhaseParticipantsBatch } from '@/lib/supabase/queries/league-phases';
import { getPhaseRoundById, getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPhaseMatchOutcome } from '@/lib/supabase/queries/phase-match-outcomes';
import { getNativeKitMatchFacts, getNativeKitCompletedRecords, getNativeKitOutcomes, getNativeKitGameCounts, getNativeKitKills } from '@/lib/supabase/queries/phase-format-runtime';
import { getGroupsByPhase } from '@/lib/supabase/queries/phase-groups';
import { actionFlagKey } from '@/lib/format-engine/runtime/actions';
import type { Phase } from '@/types/league-phase';

const scope = { id: 'phase', season_id: 'league' };
const request = { phase: scope, matchId: 'match', roundId: 'round', player1Id: 'p1', player2Id: 'p2', winnerId: 'p1', confirmedAt: '2026-11-17T10:00:00Z' };
const callbacks = { enroll: vi.fn(), auditMatchTeams: vi.fn(), stageCompleted: vi.fn(), invalidate: vi.fn() };
let ctx: KitContext;
let effects: ReturnType<typeof createNativeKitMatchEffects>;

beforeEach(() => {
  vi.resetAllMocks();
  const def = structuredClone(giftDef());
  delete def.stages[0].end_when;
  ctx = { seasonId: 'league', seed: 'synthetic', revision: 7, def, state: stateFor(def), tunableIssues: [], phases: [{ id: 'phase', stage: def.stages[0], members: ['p1', 'p2'] }] };
  vi.mocked(loadFreshKitContext).mockImplementation(async () => ctx);
  vi.mocked(getPhaseRoundById).mockResolvedValue({ id: 'round', phase_id: 'phase', round_number: 3 } as never);
  vi.mocked(getPhaseMatchById).mockResolvedValue({ id: 'match', phase_id: 'phase', round_id: 'round', status: 'completed', player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', confirmed_at: request.confirmedAt } as never);
  vi.mocked(getPhaseMatchOutcome).mockResolvedValue(null);
  vi.mocked(firePhaseFormatMatchEvent).mockResolvedValue(true);
  vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [] } as never);
  vi.mocked(openChecks).mockResolvedValue([]);
  vi.mocked(resolveCheck).mockResolvedValue(true);
  vi.mocked(getNativeKitCompletedRecords).mockResolvedValue([]);
  vi.mocked(getNativeKitOutcomes).mockResolvedValue([]);
  vi.mocked(getNativeKitGameCounts).mockResolvedValue({});
  vi.mocked(getNativeKitKills).mockResolvedValue({});
  vi.mocked(getGroupsByPhase).mockResolvedValue([]);
  callbacks.enroll.mockResolvedValue({ enrolled_count: 0 });
  effects = createNativeKitMatchEffects(callbacks);
});

describe('native kit match effects', () => {
  it('plans real round progress and uses the distinct winner/confirmation fence', async () => {
    expect(await effects.completed(request)).toBe(true);
    expect(firePhaseFormatMatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'match_completed:match', revision: 7,
      payload: expect.objectContaining({ round: 3 }),
      matchFence: { matchId: 'match', confirmedAt: request.confirmedAt, winnerId: 'p1' },
      ops: expect.arrayContaining([{ op: 'set_track', track: 'milestones', player_id: 'p1', step: 1 }]),
    }));
    expect(callbacks.auditMatchTeams).toHaveBeenCalledWith(request, 0, ctx);
  });

  it('replays the completion with the next generation and does not climb its old track step', async () => {
    ctx.state.firedEventKeys = ['match_completed:match', 'match_reverted:match:1'];
    ctx.state.tracks = { p1: { milestones: 1 } };
    vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [{ event_key: 'match_completed:match', ops: [{ op: 'set_track', player_id: 'p1', track: 'milestones', step: 1 }] }] } as never);
    expect(await effects.completed(request)).toBe(true);
    expect(firePhaseFormatMatchEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'match_completed:match:1', ops: expect.arrayContaining([{ op: 'set_track', track: 'milestones', player_id: 'p1', step: 1 }]) }));
  });

  it('reports a stale native write without burning a new key', async () => {
    vi.mocked(firePhaseFormatMatchEvent).mockRejectedValue({ code: 'format_context_stale' });
    const report = { stale: false, failed: false };
    expect(await effects.completed({ ...request, report })).toBe(false);
    expect(report).toEqual({ stale: true, failed: false });
  });

  it('repairs a pending action lock through the native event port on a completion retry', async () => {
    ctx.state.firedEventKeys = ['match_completed:match'];
    const action = ctx.def.rules.find((rule) => rule.kind === 'player.action');
    if (action === undefined) throw new Error('fixture requires an action');
    ctx.state.flags[actionFlagKey(action.id)] = 'locked';
    expect(await effects.completed(request)).toBe(true);
    expect(firePhaseFormatMatchEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKey: `action_locked:${action.id}`, event: 'action_locked' }));
    expect(firePhaseFormatMatchEvent).not.toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'match_completed:match' }));
  });

  it('requires an explicit confirmation fence rather than dropping it', async () => {
    await expect(effects.completed({ ...request, confirmedAt: undefined as never })).rejects.toThrow('confirmed_at');
    expect(firePhaseFormatMatchEvent).not.toHaveBeenCalled();
  });

  it('keeps the native winner fence for a NULL historical token and reports a changed token as stale', async () => {
    vi.mocked(getPhaseMatchById).mockResolvedValue({ id: 'match', phase_id: 'phase', round_id: 'round', player_1_id: 'p1', player_2_id: 'p2', confirmed_at: null } as never);
    expect(await effects.completed({ ...request, confirmedAt: null })).toBe(true);
    expect(firePhaseFormatMatchEvent).toHaveBeenCalledWith(expect.objectContaining({ matchFence: { matchId: 'match', confirmedAt: null, winnerId: 'p1' } }));
    vi.mocked(firePhaseFormatMatchEvent).mockRejectedValue({ code: 'format_context_stale' });
    const report = { stale: false, failed: false };
    expect(await effects.completed({ ...request, confirmedAt: null, report })).toBe(false);
    expect(report).toEqual({ stale: true, failed: false });
  });

  it('backfills round_end only after its native completion effects exist', async () => {
    vi.mocked(getPhaseRoundById).mockResolvedValue({ id: 'round', phase_id: 'phase', round_number: 3, status: 'completed' } as never);
    vi.mocked(getNativeKitMatchFacts).mockResolvedValue([{ id: 'match', round_id: 'round', status: 'completed', winner_id: 'p1', player_1_id: 'p1', player_2_id: 'p2' }]);
    expect(await effects.roundCompleted({ phase: scope, roundId: 'round' })).toBe(false);
    expect(firePhaseFormatMatchEvent).not.toHaveBeenCalled();
    ctx.state.firedEventKeys.push('match_completed:match');
    expect(await effects.roundCompleted({ phase: scope, roundId: 'round' })).toBe(true);
    expect(firePhaseFormatMatchEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'round_end:main:3', event: 'round_end' }));
  });

  it('rejects cross-phase context before writing an event', async () => {
    vi.mocked(getPhaseRoundById).mockResolvedValue({ id: 'round', phase_id: 'other' } as never);
    await expect(effects.completed(request)).rejects.toThrow('context does not match');
    expect(firePhaseFormatMatchEvent).not.toHaveBeenCalled();
  });

  it('closes generation checks and reverses only applied grants, then recovers an unresolved native dispute', async () => {
    ctx.state.firedEventKeys = ['match_completed:match'];
    ctx.state.checks = [{ id: 'check', status: 'open', source: 'unresolved_outcome', dedupe_key: 'unresolved:match:0' }] as never;
    vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [{ event_key: 'match_completed:match', ops: [
      { op: 'adjust_points', stage: 'main', player_id: 'p1', points: 4, reason: 'win' },
      { op: 'grant_item', resource: 'gifts', player_id: 'p1', item_id: null, amount: 1 },
    ], payload: { skipped_grants: [{ resource: 'gifts', player_id: 'p1', item_id: null }] } }] } as never);
    vi.mocked(getPhaseMatchById).mockResolvedValue({ status: 'disputed', player_1_id: 'p1', player_2_id: 'p2' } as never);
    vi.mocked(getPhaseMatchOutcome).mockResolvedValue({ kind: 'unresolved' } as never);
    expect(await effects.reverted({ phase: scope, matchId: 'match' })).toBe(true);
    expect(resolveCheck).toHaveBeenCalledWith(expect.objectContaining({ checkId: 'check', status: 'rejected', note: 'match_reset' }));
    expect(firePhaseFormatMatchEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKey: 'match_reverted:match:1', ops: [{ op: 'adjust_points', stage: 'main', player_id: 'p1', points: -4, reason: 'reverted: win' }] }));
    expect(openChecks).toHaveBeenCalledWith('league', expect.arrayContaining([expect.objectContaining({ dedupe_key: 'unresolved:match:1' })]), 7);
  });

  it('does not advance the generation while a check cannot close', async () => {
    ctx.state.firedEventKeys = ['match_completed:match'];
    ctx.state.checks = [{ id: 'check', status: 'open', source: 'unresolved_outcome', dedupe_key: 'unresolved:match:0' }] as never;
    vi.mocked(resolveCheck).mockRejectedValue(new Error('write failed'));
    expect(await effects.reverted({ phase: scope, matchId: 'match' })).toBe(false);
    expect(firePhaseFormatMatchEvent).not.toHaveBeenCalled();
  });

  it('defers end_when until the other native matches have completion effects', async () => {
    ctx.def.stages[0].end_when = { kind: 'rounds', rounds: 1 };
    vi.mocked(getRoundsByPhase).mockResolvedValue([{ id: 'round', round_number: 3, status: 'completed' }] as never);
    vi.mocked(getNativeKitMatchFacts).mockResolvedValue([{ id: 'other', round_id: 'round', status: 'completed', winner_id: 'p1', player_1_id: 'p1', player_2_id: 'p2' }]);
    expect(await effects.completed(request)).toBe(true);
    expect(completePhaseIfActive).not.toHaveBeenCalled();
    expect(await effects.statusPort.settled(ctx, 'phase')).toBe(false);
  });

  it('completes the actual native phase and reacts before its P4 stage callback', async () => {
    ctx.def.stages[0].end_when = { kind: 'rounds', rounds: 1 };
    ctx.def.edges = [];
    vi.mocked(getRoundsByPhase).mockResolvedValue([{ id: 'round', round_number: 3, status: 'completed', bye_player_ids: [] }] as never);
    vi.mocked(getNativeKitMatchFacts).mockResolvedValue([]);
    vi.mocked(getPhaseById).mockResolvedValue({ ...scope, status: 'active' } as Phase);
    vi.mocked(completePhaseIfActive).mockResolvedValue({ outcome: 'completed', phase: { ...scope, status: 'completed' } as Phase });
    expect(await effects.completed(request)).toBe(true);
    expect(completePhaseIfActive).toHaveBeenCalledWith('phase', []);
    expect(firePhaseFormatMatchEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'stage_end' }));
    expect(callbacks.stageCompleted).toHaveBeenCalledWith(expect.objectContaining({ phase: expect.objectContaining({ id: 'phase', status: 'completed' }), retry: false, reaction: expect.objectContaining({ applied: true }) }));
    expect(vi.mocked(firePhaseFormatMatchEvent).mock.invocationCallOrder[1]).toBeLessThan(callbacks.stageCompleted.mock.invocationCallOrder[0]);
  });

  it('reads stage-ended advancements from real native phases and participants', async () => {
    vi.mocked(getPhasesBySeasonId).mockResolvedValue([{ id: 'next', name: 'Final', enrollment_source: { type: 'standings', contributions: [{ source_phase_id: 'phase', player_ids: ['p1', 'removed'] }] } }] as never);
    vi.mocked(getPhaseParticipantsBatch).mockResolvedValue(new Map([['next', [{ id: 'p1', name: 'Player One' }]]]) as never);
    expect(await effects.stageEndedWarning({ ...scope, name: 'League', status: 'completed', season_format_type: 'custom' } as Phase, true)).toEqual({ phase_id: 'phase', phase_name: 'League', advanced: [{ phase_id: 'next', phase_name: 'Final', players: [{ id: 'p1', name: 'Player One' }] }] });
  });
});
