import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/revalidation', () => ({ expireTournamentReads: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('../hooks', () => ({ stageEnded: vi.fn() }));
vi.mock('../load', () => ({
  loadFreshKitContext: vi.fn(),
  phaseById: (ctx: { phases: { id: string }[] }, id: string) => ctx.phases.find((phase) => phase.id === id),
}));
vi.mock('../../auto-advance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auto-advance')>()),
  autoAdvanceTargets: vi.fn(),
  runAutoAdvance: vi.fn(),
}));

import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { autoAdvanceTargets, runAutoAdvance } from '../../auto-advance';
import { stageEnded } from '../hooks';
import { loadFreshKitContext } from '../load';
import { advanceAfterStageEnd, stageEndFired } from '../stage-end-advance';

const group = (id: string) => ({ id, stage: { key: 'groups', foreach_group: {} } });
const ctx = { phases: [group('g-1'), group('g-2')] } as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadFreshKitContext).mockResolvedValue(ctx);
  vi.mocked(autoAdvanceTargets).mockResolvedValue(['t-1']);
  vi.mocked(getTournamentById).mockResolvedValue({ id: 't-1', enrollment_source: null } as never);
  vi.mocked(runAutoAdvance).mockResolvedValue([{ target_phase_id: 't-1', enrolled_count: 2 }]);
});

describe('advanceAfterStageEnd in a stage that repeats per group', () => {
  it('moves nobody while another group is still running, and that is no failure', async () => {
    vi.mocked(stageEnded).mockResolvedValue(false);
    await expect(advanceAfterStageEnd({ seasonId: 's-1', phaseId: 'g-1', retry: false })).resolves.toEqual({ ran: false, results: [], error: null });
    expect(runAutoAdvance).not.toHaveBeenCalled();
  });

  it('advances every group when the last one completes, after stage_end had its say', async () => {
    vi.mocked(stageEnded).mockResolvedValue(true);
    const outcome = await advanceAfterStageEnd({ seasonId: 's-1', phaseId: 'g-2', retry: false });
    expect(vi.mocked(runAutoAdvance).mock.calls.map((call) => call[1])).toEqual(['g-2', 'g-1']);
    expect(outcome).toMatchObject({ ran: true, error: null });
    expect(outcome.results).toHaveLength(2);
  });

  it('leaves an earlier group alone whose players a target already holds', async () => {
    vi.mocked(stageEnded).mockResolvedValue(true);
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't-1', enrollment_source: { contributions: [{ source_phase_id: 'g-1' }] } } as never);
    await advanceAfterStageEnd({ seasonId: 's-1', phaseId: 'g-2', retry: false });
    expect(vi.mocked(runAutoAdvance).mock.calls.map((call) => call[1])).toEqual(['g-2']);
  });

  it('still advances the other groups when one of them fails', async () => {
    vi.mocked(stageEnded).mockResolvedValue(true);
    vi.mocked(runAutoAdvance).mockRejectedValueOnce(new Error('boom'));
    const outcome = await advanceAfterStageEnd({ seasonId: 's-1', phaseId: 'g-2', retry: false });
    expect(runAutoAdvance).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ ran: true, error: 'auto_advance_failed' });
    expect(outcome.results).toHaveLength(1);
  });

  it('runs just the phase itself in a stage without groups', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue({ phases: [{ id: 'p-1', stage: { key: 'main' } }] } as never);
    await advanceAfterStageEnd({ seasonId: 's-1', phaseId: 'p-1', retry: false });
    expect(vi.mocked(runAutoAdvance).mock.calls.map((call) => call[1])).toEqual(['p-1']);
    expect(stageEnded).not.toHaveBeenCalled();
  });
});

describe('stageEndFired', () => {
  it('answers from the event log of the stage, and false when the read fails', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue({ phases: [group('g-1')], state: { firedEventKeys: ['stage_end:groups'] } } as never);
    await expect(stageEndFired('s-1', 'g-1')).resolves.toBe(true);
    vi.mocked(loadFreshKitContext).mockResolvedValue({ phases: [group('g-1')], state: { firedEventKeys: [] } } as never);
    await expect(stageEndFired('s-1', 'g-1')).resolves.toBe(false);
    vi.mocked(loadFreshKitContext).mockRejectedValue(new Error('db'));
    await expect(stageEndFired('s-1', 'g-1')).resolves.toBe(false);
  });
});
