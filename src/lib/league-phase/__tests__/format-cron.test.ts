import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEED, PLAYERS, stateFor, wichtelDef } from '@/lib/format-engine/runtime/__tests__/helpers';
import type { KitContext } from '@/lib/format-engine/runtime/load';
import type { NativeFormatCronInput } from '../format-cron';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));
vi.mock('@/lib/match/finalize', () => ({}));
vi.mock('@/lib/supabase/queries/matches', () => ({}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({}));
vi.mock('@/lib/supabase/queries/rounds', () => ({}));
vi.mock('@/lib/supabase/queries/teams', () => ({}));
vi.mock('@/lib/format-engine/runtime/actions-server', () => ({}));
vi.mock('@/lib/format-engine/challenge-server', () => ({}));
vi.mock('@/lib/format-engine/runtime/phase-complete', () => ({}));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({}));
vi.mock('@/lib/format-engine/runtime/fire', () => ({ fireEvent: vi.fn(), fireLockedActionEvents: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-cron', () => ({ listKitSeasonIds: vi.fn(), listKitIdleSeasonIds: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getSeasonKitHead: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', async (original) => ({ ...await original<typeof import('@/lib/supabase/queries/format-runtime')>(), openFormatCheck: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-format-cron', () => ({ listNativeKitCronPhases: vi.fn(), listNativeFinalizedMatches: vi.fn(), listNativeUncompletedMatches: vi.fn(), completePhaseFormatForfeit: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: vi.fn(), getMatchesByPhase: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getRoundsByPhase: vi.fn(), listRoundStatusesByPhaseIds: vi.fn() }));

import { createNativeFormatCronPass } from '../format-cron';
import { fireLockedActionEvents } from '@/lib/format-engine/runtime/fire';
import { listKitSeasonIds, listKitIdleSeasonIds } from '@/lib/supabase/queries/format-cron';
import { getSeasonKitHead } from '@/lib/supabase/queries/format-engine';
import { listNativeKitCronPhases, listNativeFinalizedMatches, listNativeUncompletedMatches, completePhaseFormatForfeit } from '@/lib/supabase/queries/phase-format-cron';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPhaseMatchById, getMatchesByPhase } from '@/lib/supabase/queries/phase-matches';
import { getRoundsByPhase, listRoundStatusesByPhaseIds } from '@/lib/supabase/queries/phase-rounds';
import { logAuditEvent } from '@/lib/audit/log';
import { FormatRuntimeError } from '@/lib/supabase/queries/format-runtime';

const now = new Date('2026-06-09T00:00:00Z');
const staged = { setAt: '2026-06-09T00:00:00.123456Z' };
const services = { stageAdminOutcome: vi.fn(), discardStagedAdminOutcome: vi.fn(), finalizeMatchCompletion: vi.fn() };
const kit = {
  eventPort: { load: vi.fn() }, completed: vi.fn(), reverted: vi.fn(), roundCompleted: vi.fn(), completeStage: vi.fn(),
};
const effects = { listTeams: vi.fn(), submitAction: vi.fn(), expireChallenges: vi.fn(), purgeNotifications: vi.fn(), revalidate: vi.fn() };
const match = { id: 'match', phase_id: 'phase', round_id: 'round', player_1_id: 'p1', player_2_id: 'p2', player_1_name: 'One', player_2_name: 'Two', status: 'scheduled', winner_id: null };
let ctx: KitContext;
let pass: ReturnType<typeof createNativeFormatCronPass>;

beforeEach(() => {
  vi.resetAllMocks();
  const def = wichtelDef();
  const calendar = { start: { kind: 'date' as const, date: '2026-06-01' }, time: '18:00', cadence: 'weekly' as const, every: 1, round_window_hours: 168, marks: [], deadlines: [{ applies: 'match' as const, offset_hours: 0, on_miss: 'forfeit' as const }] };
  ctx = { seasonId: 'league', seed: SEED, revision: 7, def, state: stateFor(def), tunableIssues: [], phases: [{ id: 'phase', stage: { ...def.stages[0], calendar }, members: PLAYERS }] };
  kit.eventPort.load.mockResolvedValue(ctx);
  kit.completed.mockResolvedValue(true);
  kit.reverted.mockResolvedValue(true);
  kit.roundCompleted.mockResolvedValue(true);
  kit.completeStage.mockResolvedValue('completed');
  vi.mocked(fireLockedActionEvents).mockResolvedValue([]);
  vi.mocked(listKitSeasonIds).mockResolvedValue(['league']);
  vi.mocked(listKitIdleSeasonIds).mockResolvedValue([]);
  vi.mocked(listNativeKitCronPhases).mockResolvedValue([{ id: 'phase', season_id: 'league', status: 'active', format_stage_key: 'swiss', season_start_date: '2026-06-01', clock_shift_seconds: 0 }]);
  vi.mocked(listNativeFinalizedMatches).mockResolvedValue([]);
  vi.mocked(listNativeUncompletedMatches).mockResolvedValue([]);
  vi.mocked(listRoundStatusesByPhaseIds).mockResolvedValue([]);
  vi.mocked(getPhaseById).mockResolvedValue({ id: 'phase', status: 'active' } as never);
  vi.mocked(getPhaseMatchById).mockResolvedValue(match as never);
  vi.mocked(getMatchesByPhase).mockResolvedValue([match] as never);
  vi.mocked(getRoundsByPhase).mockResolvedValue([{ id: 'round', round_number: 1, deadline: null }] as never);
  vi.mocked(getSeasonKitHead).mockResolvedValue({ engine: 'kit', seed: SEED, revision: 7, clockShiftSeconds: 0 });
  vi.mocked(completePhaseFormatForfeit).mockResolvedValue(true);
  services.stageAdminOutcome.mockResolvedValue(staged);
  services.finalizeMatchCompletion.mockResolvedValue({ finalized: true });
  effects.listTeams.mockResolvedValue([{ player_id: 'p1', match_id: 'match' }]);
  effects.expireChallenges.mockResolvedValue(0);
  effects.purgeNotifications.mockResolvedValue(0);
  pass = createNativeFormatCronPass({ services, kit, ...effects } as unknown as NativeFormatCronInput);
});

describe('native format cron adapter and shared pass', () => {
  it('stages a native forfeit before CAS and finalizes through the configured service', async () => {
    const result = await pass(now);
    expect(result).toMatchObject({ forfeits: 1, failures: 0 });
    expect(services.stageAdminOutcome).toHaveBeenCalledWith('match', expect.objectContaining({ kind: 'forfeit', setBy: null }));
    expect(completePhaseFormatForfeit).toHaveBeenCalledWith(expect.objectContaining({ seasonId: 'league', matchId: 'match', player1Id: 'p1', player2Id: 'p2', winnerId: 'p1', expectedStatus: 'scheduled', revision: 7 }));
    expect(services.stageAdminOutcome.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(completePhaseFormatForfeit).mock.invocationCallOrder[0]);
    expect(services.finalizeMatchCompletion).toHaveBeenCalledWith(expect.objectContaining({ match: expect.objectContaining({ phase_id: 'phase', status: 'completed', winner_id: 'p1' }) }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ resource_type: 'phase_match', metadata: expect.objectContaining({ phase_id: 'phase' }) }));
    expect(effects.revalidate).toHaveBeenCalledWith('phase', 'match');
  });

  it('takes back only its staged outcome when the native CAS misses', async () => {
    vi.mocked(completePhaseFormatForfeit).mockResolvedValue(false);
    expect(await pass(now)).toMatchObject({ forfeits: 0, failures: 0 });
    expect(services.discardStagedAdminOutcome).toHaveBeenCalledWith('match', staged);
    expect(services.finalizeMatchCompletion).not.toHaveBeenCalled();
  });

  it('keeps a possibly committed outcome on an ambiguous completed-write failure', async () => {
    vi.mocked(completePhaseFormatForfeit).mockRejectedValue(new Error('timeout'));
    vi.mocked(getPhaseMatchById).mockResolvedValue({ ...match, status: 'completed' } as never);
    expect(await pass(now)).toMatchObject({ forfeits: 0, failures: 1 });
    expect(services.discardStagedAdminOutcome).not.toHaveBeenCalled();
  });

  it('treats a changed format as a retry and cleans its staged forfeit', async () => {
    vi.mocked(completePhaseFormatForfeit).mockRejectedValue(new FormatRuntimeError('format_context_stale'));
    expect(await pass(now)).toMatchObject({ forfeits: 0, failures: 0 });
    expect(services.discardStagedAdminOutcome).toHaveBeenCalledWith('match', staged);
  });

  it('backfills native completion and round hooks with real phase identity', async () => {
    vi.mocked(listNativeKitCronPhases).mockResolvedValue([]);
    vi.mocked(listNativeFinalizedMatches).mockResolvedValue([{ ...match, winner_id: 'p1', confirmed_at: '2026-06-08T00:00:00Z' }]);
    vi.mocked(listRoundStatusesByPhaseIds).mockResolvedValue([{ id: 'round', phase_id: 'phase', round_number: 1, status: 'completed' }]);
    expect(await pass(now)).toMatchObject({ completions_backfilled: 1, failures: 0 });
    expect(kit.completed).toHaveBeenCalledWith(expect.objectContaining({ phase: { id: 'phase', season_id: 'league' }, confirmedAt: '2026-06-08T00:00:00Z', auditRetry: 'always' }));
    expect(kit.roundCompleted).toHaveBeenCalledWith(expect.objectContaining({ phase: { id: 'phase', season_id: 'league' }, roundId: 'round' }));
    expect(kit.completed.mock.invocationCallOrder[0]).toBeLessThan(kit.roundCompleted.mock.invocationCallOrder[0]);
  });

  it('backfills historical NULL confirmations with an explicit native fence', async () => {
    vi.mocked(listNativeKitCronPhases).mockResolvedValue([]);
    vi.mocked(listNativeFinalizedMatches).mockResolvedValue([{ ...match, winner_id: 'p1', confirmed_at: null }, { ...match, id: 'next', winner_id: 'p1', confirmed_at: '2026-06-08T00:00:00Z' }]);
    expect(await pass(now)).toMatchObject({ completions_backfilled: 2, failures: 0 });
    expect(kit.completed).toHaveBeenCalledTimes(2);
    expect(kit.completed).toHaveBeenCalledWith(expect.objectContaining({ matchId: 'match', confirmedAt: null }));
    expect(kit.completed).toHaveBeenCalledWith(expect.objectContaining({ matchId: 'next' }));
  });

  it('heals native reverts in idle leagues without executing deadlines', async () => {
    vi.mocked(listNativeKitCronPhases).mockResolvedValue([]);
    vi.mocked(listKitSeasonIds).mockResolvedValue([]);
    vi.mocked(listKitIdleSeasonIds).mockResolvedValue(['league']);
    ctx.state.firedEventKeys = ['match_completed:match'];
    vi.mocked(listNativeUncompletedMatches).mockResolvedValue([{ id: 'match', phase_id: 'phase', status: 'scheduled' }]);
    expect(await pass(now)).toMatchObject({ failures: 0 });
    expect(kit.reverted).toHaveBeenCalledWith(expect.objectContaining({ phase: { id: 'phase', season_id: 'league' }, matchId: 'match' }));
    expect(completePhaseFormatForfeit).not.toHaveBeenCalled();
    expect(effects.listTeams).not.toHaveBeenCalled();
  });

  it('retains the per-league completion budget and forwards event storage for lock repair', async () => {
    vi.mocked(listNativeKitCronPhases).mockResolvedValue([]);
    vi.mocked(listNativeFinalizedMatches).mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({ ...match, id: `match-${index}`, winner_id: 'p1', confirmed_at: '2026-06-08T00:00:00Z' })));
    expect(await pass(now)).toMatchObject({ completions_backfilled: 10 });
    expect(kit.completed).toHaveBeenCalledTimes(10);
    expect(fireLockedActionEvents).toHaveBeenCalledWith('league', null, expect.objectContaining({ port: kit.eventPort }));
  });
});
