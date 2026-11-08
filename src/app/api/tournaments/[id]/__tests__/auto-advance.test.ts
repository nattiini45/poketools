/**
 * PATCH /api/tournaments/[id]: a kit league phase that completes runs the `auto` edges out of it; a failed advance
 * never fails the status change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/format-studio/phase-guards', () => ({
  assertSeasonPhasesFree: vi.fn(),
  assertFormatPhaseDeletable: vi.fn(),
  assertFormatPhaseUnchanged: vi.fn(),
  assertFormatPhaseStatusUnchanged: vi.fn(),
  assertFormatPhaseRosterOpen: vi.fn(),
  assertSeasonRosterMembers: vi.fn(),
}));
vi.mock('@/lib/ruleset-studio/pin-change', () => ({ assertRulesetChangeAllowed: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getTournamentWithDetails: vi.fn(),
  updateTournament: vi.fn(),
  deleteTournament: vi.fn(),
  getParticipants: vi.fn(),
  getStagesBySeasonId: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({ rebuildAfterTournamentDelete: vi.fn() }));
vi.mock('@/lib/tournament/bracket-propagation', () => ({ syncBracketResetSetting: vi.fn(), syncThirdPlaceSetting: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
  diffField: (changes: Record<string, { before: unknown; after: unknown }>, field: string, before: unknown, after: unknown) => {
    if (before !== after) changes[field] = { before, after };
  },
}));
vi.mock('@/lib/format-engine/auto-advance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format-engine/auto-advance')>()),
  runAutoAdvance: vi.fn(),
  autoAdvanceTargets: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format-engine/runtime/load')>()),
  loadFreshKitContext: vi.fn(async () => null),
}));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onPhaseStatusChanged: vi.fn() }));

import { PATCH } from '@/app/api/tournaments/[id]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getTournamentById, updateTournament } from '@/lib/supabase/queries/tournaments';
import { logAuditEvent } from '@/lib/audit/log';
import { AutoAdvanceError, autoAdvanceTargets, runAutoAdvance } from '@/lib/format-engine/auto-advance';
import { onPhaseStatusChanged } from '@/lib/format-engine/runtime/hooks';
import { UserFacingError } from '@/lib/api/user-facing-error';

const ID = '22222222-2222-4222-8222-222222222222';
const SEASON = '33333333-3333-4333-8333-333333333333';
const TARGET = '44444444-4444-4444-8444-444444444444';

const phase = {
  id: ID,
  name: 'Groups',
  season_id: SEASON,
  season_format_type: 'custom',
  status: 'active' as const,
  bracket_type: 'round_robin' as const,
  ruleset_id: null,
  best_of_default: 1,
  bo_overrides: {},
  is_doubles: false,
  team_visibility: 'public',
  bracket_reset_enabled: true,
  stage_order: 1,
  archived: false,
};

const patch = (body: unknown) =>
  PATCH({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest, { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'p-1', name: 'Admin' } as never);
  vi.mocked(getTournamentById).mockResolvedValue(phase as never);
  vi.mocked(updateTournament).mockImplementation(async (_id, input) => ({ ...phase, ...input }) as never);
  vi.mocked(onPhaseStatusChanged).mockResolvedValue(true);
  vi.mocked(autoAdvanceTargets).mockResolvedValue([]);
});

describe('PATCH /api/tournaments/[id]: auto advance', () => {
  it('runs the auto edges when a custom league phase completes and records them', async () => {
    vi.mocked(runAutoAdvance).mockResolvedValue([{ target_phase_id: TARGET, enrolled_count: 8 }]);
    const res = await patch({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(runAutoAdvance).toHaveBeenCalledWith(SEASON, ID);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toEqual({
      auto_advance: [{ target_phase_id: TARGET, enrolled_count: 8 }],
      auto_advance_error: null,
    });
  });

  it('keeps the status change when the advance fails, and records the cause', async () => {
    vi.mocked(runAutoAdvance).mockRejectedValue(
      new UserFacingError('This advancement needs the list of players who move on.', {
        code: 'advance_manual_list_required',
        status: 409,
      }),
    );
    const res = await patch({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({
      auto_advance: [],
      auto_advance_error: 'advance_manual_list_required',
    });
  });

  it('keeps the targets that advanced when another target failed: audit entry and cache expiry', async () => {
    vi.mocked(runAutoAdvance).mockRejectedValue(
      new AutoAdvanceError(
        [{ target_phase_id: TARGET, enrolled_count: 8 }],
        [
          {
            target_phase_id: 'other',
            error: new UserFacingError('This advancement needs the list of players who move on.', { code: 'advance_manual_list_required', status: 409 }),
          },
        ],
      ),
    );
    const res = await patch({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({
      auto_advance: [{ target_phase_id: TARGET, enrolled_count: 8 }],
      auto_advance_error: 'advance_manual_list_required',
    });
  });

  it('tells the format runtime about a status change', async () => {
    vi.mocked(runAutoAdvance).mockResolvedValue([]);
    await patch({ status: 'completed' });
    expect(onPhaseStatusChanged).toHaveBeenCalledWith({ tournament: phase, from: 'active', to: 'completed' });
    vi.mocked(onPhaseStatusChanged).mockClear();
    await patch({ name: 'Renamed' });
    expect(onPhaseStatusChanged).not.toHaveBeenCalled();
  });

  it('replays the reaction when the same status is sent again (a first call whose reaction died after the commit)', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...phase, status: 'completed' } as never);
    await patch({ status: 'completed' });
    expect(onPhaseStatusChanged).toHaveBeenCalledWith({ tournament: { ...phase, status: 'completed' }, from: 'active', to: 'completed' });
    vi.mocked(onPhaseStatusChanged).mockClear();
    vi.mocked(getTournamentById).mockResolvedValue(phase as never);
    await patch({ status: 'active' });
    expect(onPhaseStatusChanged).toHaveBeenCalledWith({ tournament: phase, from: 'upcoming', to: 'active' });
    expect(runAutoAdvance).not.toHaveBeenCalled();
  });

  it('reports a failed reaction as a warning and in the audit entry instead of dropping it', async () => {
    vi.mocked(runAutoAdvance).mockResolvedValue([]);
    vi.mocked(onPhaseStatusChanged).mockResolvedValue(false);
    const res = await patch({ status: 'completed' });
    expect(res.status).toBe(200);
    expect((await res.json()).warnings).toEqual([{ code: 'format_reaction_failed' }]);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ format_reaction_error: 'phase_status_hook_failed' });
  });

  it('runs nothing for another status, a phase already completed or another league type', async () => {
    await patch({ status: 'active' });
    vi.mocked(getTournamentById).mockResolvedValue({ ...phase, status: 'completed' } as never);
    await patch({ status: 'completed' });
    vi.mocked(getTournamentById).mockResolvedValue({ ...phase, season_format_type: 'singles' } as never);
    await patch({ status: 'completed' });
    expect(runAutoAdvance).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tournaments/[id]: the advance follows the format reaction', () => {
  const holdingTarget = {
    id: TARGET,
    season_id: SEASON,
    status: 'upcoming' as const,
    enrollment_source: { type: 'standings', source_phase_id: ID, synced_at: 'x', frozen: false, contributions: [{ source_phase_id: ID, player_ids: ['a'] }] },
  };

  it('runs the stage_end reaction before it picks the players who move on', async () => {
    vi.mocked(runAutoAdvance).mockResolvedValue([]);
    await patch({ status: 'completed' });
    expect(vi.mocked(onPhaseStatusChanged).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(runAutoAdvance).mock.invocationCallOrder[0]);
  });

  it('holds the advance back when the reaction failed: warning and response unchanged, the hold recorded in the audit entry', async () => {
    vi.mocked(onPhaseStatusChanged).mockResolvedValue(false);
    const res = await patch({ status: 'completed' });
    expect(res.status).toBe(200);
    expect((await res.json()).warnings).toEqual([{ code: 'format_reaction_failed' }]);
    expect(runAutoAdvance).not.toHaveBeenCalled();
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({
      format_reaction_error: 'phase_status_hook_failed',
      auto_advance_held: true,
    });
  });

  it('runs the held advance when the same status is sent again and the replayed reaction applies', async () => {
    vi.mocked(getTournamentById).mockImplementation((async (id: string) =>
      id === TARGET ? { ...holdingTarget, enrollment_source: null } : { ...phase, status: 'completed' }) as never);
    vi.mocked(autoAdvanceTargets).mockResolvedValue([TARGET]);
    vi.mocked(runAutoAdvance).mockResolvedValue([{ target_phase_id: TARGET, enrolled_count: 8 }]);

    const res = await patch({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(runAutoAdvance).toHaveBeenCalledWith(SEASON, ID);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toEqual({
      auto_advance: [{ target_phase_id: TARGET, enrolled_count: 8 }],
      auto_advance_error: null,
    });
  });

  it('does not run the advance a second time when the same status is sent again after it happened', async () => {
    vi.mocked(getTournamentById).mockImplementation((async (id: string) => (id === TARGET ? holdingTarget : { ...phase, status: 'completed' })) as never);
    vi.mocked(autoAdvanceTargets).mockResolvedValue([TARGET]);

    await patch({ status: 'completed' });

    expect(runAutoAdvance).not.toHaveBeenCalled();
  });
});
