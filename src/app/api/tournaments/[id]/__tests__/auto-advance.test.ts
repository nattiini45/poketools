/**
 * PATCH /api/tournaments/[id]: a kit league phase that completes runs the `auto` edges out of it; a failed advance
 * never fails the status change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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
}));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onPhaseStatusChanged: vi.fn() }));

import { PATCH } from '@/app/api/tournaments/[id]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getTournamentById, updateTournament } from '@/lib/supabase/queries/tournaments';
import { logAuditEvent } from '@/lib/audit/log';
import { AutoAdvanceError, runAutoAdvance } from '@/lib/format-engine/auto-advance';
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

  it('tells the format runtime about a status change, and only a change', async () => {
    vi.mocked(runAutoAdvance).mockResolvedValue([]);
    await patch({ status: 'completed' });
    expect(onPhaseStatusChanged).toHaveBeenCalledWith({ tournament: phase, from: 'active', to: 'completed' });
    vi.mocked(onPhaseStatusChanged).mockClear();
    await patch({ status: 'active' });
    expect(onPhaseStatusChanged).not.toHaveBeenCalled();
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
