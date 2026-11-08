import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/revalidation', () => ({ expireTournamentReads: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn(), completeTournamentIfActive: vi.fn() }));
vi.mock('../load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format-engine/runtime/load')>()),
  loadFreshKitContext: vi.fn(async () => null),
}));
vi.mock('../hooks', () => ({ isKitCandidate: vi.fn(() => true), onPhaseStatusChanged: vi.fn() }));
vi.mock('../../auto-advance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auto-advance')>()),
  runAutoAdvance: vi.fn(),
  autoAdvanceTargets: vi.fn(),
}));

import { logAuditEvent } from '@/lib/audit/log';
import { expireTournamentReads } from '@/lib/revalidation';
import { completeTournamentIfActive, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { AutoAdvanceError, autoAdvanceTargets, runAutoAdvance } from '../../auto-advance';
import { onPhaseStatusChanged } from '../hooks';
import { completePhaseAtStageEnd } from '../phase-complete';

const active = { id: 't-1', season_id: 's-1', season_format_type: 'custom', status: 'active', name: 'Groups' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTournamentById).mockResolvedValue(active as never);
  vi.mocked(completeTournamentIfActive).mockResolvedValue({ outcome: 'completed', tournament: { ...active, status: 'completed' } } as never);
  vi.mocked(onPhaseStatusChanged).mockResolvedValue(true);
  vi.mocked(autoAdvanceTargets).mockResolvedValue([]);
});

describe('completePhaseAtStageEnd', () => {
  it('skips a phase that has not started', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...active, status: 'upcoming' } as never);
    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('skipped');
    expect(completeTournamentIfActive).not.toHaveBeenCalled();
    expect(onPhaseStatusChanged).not.toHaveBeenCalled();
  });

  it('repeats only the reaction for a phase that is already completed (a retry after a reaction that failed post-flip)', async () => {
    const completed = { ...active, status: 'completed' };
    vi.mocked(getTournamentById).mockResolvedValue(completed as never);

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('skipped');

    expect(onPhaseStatusChanged).toHaveBeenCalledWith({ tournament: completed, from: 'active', to: 'completed' });
    expect(completeTournamentIfActive).not.toHaveBeenCalled();
    expect(runAutoAdvance).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('reports reaction_failed when the reaction of an already completed phase fails again', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...active, status: 'completed' } as never);
    vi.mocked(onPhaseStatusChanged).mockResolvedValue(false);
    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('reaction_failed');
  });

  it('completes the phase but reports reaction_failed when the stage-end reaction failed after the flip', async () => {
    vi.mocked(runAutoAdvance).mockResolvedValue([]);
    vi.mocked(onPhaseStatusChanged).mockResolvedValue(false);

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('reaction_failed');

    // The rest of the sequence still ran: the status write stands, so the audit entry and the announcements follow.
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
  });

  it('leaves a non-kit phase alone, completed or not', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...active, status: 'completed' } as never);
    const { isKitCandidate } = await import('../hooks');
    vi.mocked(isKitCandidate).mockReturnValueOnce(false);
    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('skipped');
    expect(onPhaseStatusChanged).not.toHaveBeenCalled();
  });

  it('skips, and runs nothing, when a concurrent call already moved the phase (the compare-and-set matched no row)', async () => {
    vi.mocked(completeTournamentIfActive).mockResolvedValue({ outcome: 'not_active' });

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('skipped');

    expect(runAutoAdvance).not.toHaveBeenCalled();
    expect(onPhaseStatusChanged).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(expireTournamentReads).not.toHaveBeenCalled();
  });

  it('hands the ids the caller saw unfinished to the compare-and-set', async () => {
    vi.mocked(runAutoAdvance).mockResolvedValue([]);

    await completePhaseAtStageEnd('t-1', 'end_when:main', ['m-1', 'm-2']);

    expect(completeTournamentIfActive).toHaveBeenCalledWith('t-1', ['m-1', 'm-2']);
  });

  it('keeps the phase active, and runs nothing, when a match the read did not see exists (a challenge accepted since)', async () => {
    vi.mocked(completeTournamentIfActive).mockResolvedValue({ outcome: 'unsettled', unknownUnfinished: 1 });

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('skipped');

    expect(runAutoAdvance).not.toHaveBeenCalled();
    expect(onPhaseStatusChanged).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(expireTournamentReads).not.toHaveBeenCalled();
  });

  it('completes the phase, expires the advanced targets and audits the count', async () => {
    vi.mocked(runAutoAdvance).mockResolvedValue([{ target_phase_id: 't-2', enrolled_count: 4 }]);

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('completed');

    expect(expireTournamentReads).toHaveBeenCalledWith('t-2', 's-1');
    expect(onPhaseStatusChanged).toHaveBeenCalledWith({ tournament: active, from: 'active', to: 'completed' });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ auto_advanced: 1, auto_advance_error: null }) }),
    );
  });

  it('keeps the targets that advanced when another target failed', async () => {
    vi.mocked(runAutoAdvance).mockRejectedValue(
      new AutoAdvanceError([{ target_phase_id: 't-2', enrolled_count: 4 }], [{ target_phase_id: 't-3', error: new Error('db down') }]),
    );

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('completed');

    expect(expireTournamentReads).toHaveBeenCalledWith('t-2', 's-1');
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ auto_advanced: 1, auto_advance_error: 'auto_advance_failed' }) }),
    );
  });

  it('records a failure that advanced nothing', async () => {
    vi.mocked(runAutoAdvance).mockRejectedValue(new Error('format unreadable'));

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('completed');

    expect(expireTournamentReads).toHaveBeenCalledTimes(1);
    expect(expireTournamentReads).toHaveBeenCalledWith('t-1', 's-1');
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ auto_advanced: 0, auto_advance_error: 'auto_advance_failed' }) }),
    );
  });
});

describe('completePhaseAtStageEnd: the advance follows the format reaction', () => {
  const upcomingTarget = { id: 't-2', season_id: 's-1', status: 'upcoming', enrollment_source: null };
  const holdingTarget = {
    ...upcomingTarget,
    enrollment_source: { type: 'standings', source_phase_id: 't-1', synced_at: 'x', frozen: false, contributions: [{ source_phase_id: 't-1', player_ids: ['a'] }] },
  };
  const withTarget = (target: unknown) => {
    vi.mocked(autoAdvanceTargets).mockResolvedValue(['t-2']);
    vi.mocked(getTournamentById).mockImplementation((async (id: string) => (id === 't-2' ? target : { ...active, status: 'completed' })) as never);
  };

  it('runs the stage_end reaction before it picks the players who move on', async () => {
    vi.mocked(runAutoAdvance).mockResolvedValue([]);

    await completePhaseAtStageEnd('t-1', 'end_when:main', []);

    const reaction = vi.mocked(onPhaseStatusChanged).mock.invocationCallOrder[0];
    const advance = vi.mocked(runAutoAdvance).mock.invocationCallOrder[0];
    expect(reaction).toBeLessThan(advance);
  });

  it('holds the advance back when the reaction failed, and says so in the audit entry', async () => {
    vi.mocked(onPhaseStatusChanged).mockResolvedValue(false);

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('reaction_failed');

    expect(runAutoAdvance).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ auto_advanced: 0, auto_advance_error: null, auto_advance_held: true }) }),
    );
  });

  it('does not mark an advance that ran as held', async () => {
    vi.mocked(runAutoAdvance).mockResolvedValue([]);
    await completePhaseAtStageEnd('t-1', 'end_when:main', []);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ auto_advance_held: false }) }));
  });

  it('runs the held advance when a retry of the reaction applies and no target holds the players of this phase yet', async () => {
    withTarget(upcomingTarget);
    vi.mocked(runAutoAdvance).mockResolvedValue([{ target_phase_id: 't-2', enrolled_count: 4 }]);

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('skipped');

    expect(runAutoAdvance).toHaveBeenCalledWith('s-1', 't-1');
    expect(expireTournamentReads).toHaveBeenCalledWith('t-2', 's-1');
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { via: 'stage_end_retry', reason: 'end_when:main', auto_advanced: 1, auto_advance_error: null } }),
    );
  });

  it('does not run the advance a second time over one that happened (a target holds a block of this phase)', async () => {
    withTarget(holdingTarget);

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('skipped');

    expect(runAutoAdvance).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('keeps the advance held while the retried reaction fails again', async () => {
    withTarget(upcomingTarget);
    vi.mocked(onPhaseStatusChanged).mockResolvedValue(false);

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('reaction_failed');

    expect(runAutoAdvance).not.toHaveBeenCalled();
  });

  it('records a held advance that fails on the retry, without failing the retry', async () => {
    withTarget(upcomingTarget);
    vi.mocked(runAutoAdvance).mockRejectedValue(new Error('format unreadable'));

    await expect(completePhaseAtStageEnd('t-1', 'end_when:main', [])).resolves.toBe('skipped');

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ via: 'stage_end_retry', auto_advanced: 0, auto_advance_error: 'auto_advance_failed' }) }),
    );
  });
});
