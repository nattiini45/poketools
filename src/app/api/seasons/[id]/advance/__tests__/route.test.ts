import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: vi.fn(),
}));

vi.mock('@/lib/tournament/enrollment-sync', () => ({
  assertEnrollmentSyncAllowed: vi.fn(),
  syncStandingsEnrollment: vi.fn(),
}));

vi.mock('@/lib/discord/notify', () => ({
  emitDiscordEvent: vi.fn(),
}));

vi.mock('@/lib/social/notify', () => ({
  emitSocialEvent: vi.fn(),
}));

import { POST } from '../route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import {
  assertEnrollmentSyncAllowed,
  syncStandingsEnrollment,
} from '@/lib/tournament/enrollment-sync';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';
import { revalidateTag } from 'next/cache';

const mockSeason = { id: 's1', name: 'Season One' };

const mockStages = [
  { id: 'stage-1', name: 'Swiss', status: 'completed', stage_order: 1, advancement_rule: null },
  {
    id: 'stage-2',
    name: 'Top Cut',
    status: 'upcoming',
    stage_order: 2,
    advancement_rule: { type: 'top_n', count: 8, per_group: false },
  },
];

const mockEnrollmentResult = {
  enrolled_count: 8,
  enrollment_source: {
    type: 'standings' as const,
    source_phase_id: 'stage-1',
    synced_at: new Date().toISOString(),
    frozen: false,
  },
  source_phase_name: 'Swiss',
};

describe('POST /api/seasons/[id]/advance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
      isAdmin: true,
      isResourceAdmin: true,
      isCreator: false,
      psUsername: '',
      championsUsername: '',
      avatarUrl: null,
      status: 'active',
    });
    vi.mocked(getSeasonById).mockResolvedValue(mockSeason as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue(mockStages as never);
    vi.mocked(assertEnrollmentSyncAllowed).mockResolvedValue(undefined);
    vi.mocked(syncStandingsEnrollment).mockResolvedValue(mockEnrollmentResult);
  });

  it('returns auth error when not authorized', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const request = makeRequest({}) as NextRequest;
    const response = await POST(request, { params: makeParams({ id: 's1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('returns 404 when season not found', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(null);

    const request = makeRequest({}) as NextRequest;
    const response = await POST(request, { params: makeParams({ id: 's1' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('League not found');
    expect(payload.code).toBe('SEASON_NOT_FOUND');
  });

  it('returns 400 when fewer than 2 phases', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([mockStages[0]] as never);

    const request = makeRequest({}) as NextRequest;
    const response = await POST(request, { params: makeParams({ id: 's1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('at least 2 phases');
    expect(payload.code).toBe('advance_needs_two_phases');
  });

  it('returns 400 when no valid phase transition found', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      { ...mockStages[0], status: 'active' },
      mockStages[1],
    ] as never);

    const request = makeRequest({}) as NextRequest;
    const response = await POST(request, { params: makeParams({ id: 's1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('No valid phase transition');
    expect(payload.code).toBe('advance_no_transition');
  });

  it('rejects a malformed body with validation_failed and the issues as a param', async () => {
    const request = makeRequest({ force: 'yes' }) as NextRequest;
    const response = await POST(request, { params: makeParams({ id: 's1' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('validation_failed');
    expect(payload.params).toEqual({ issues: payload.error });
    expect(syncStandingsEnrollment).not.toHaveBeenCalled();
  });

  it('delegates to syncStandingsEnrollment', async () => {
    const request = makeRequest({}) as NextRequest;
    const response = await POST(request, { params: makeParams({ id: 's1' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.advanced_count).toBe(8);
    expect(payload.data.summary).toContain('Swiss');
    expect(assertEnrollmentSyncAllowed).toHaveBeenCalledWith('stage-2', false);
    expect(syncStandingsEnrollment).toHaveBeenCalledWith('s1', 'stage-2', {
      source_phase_id: 'stage-1',
      force: undefined,
    });
    // D37: the league and both phases show the enrolment on the next view.
    const tags = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
    expect(tags).toEqual(expect.arrayContaining(['season:s1', 'tournament:stage-1', 'tournament:stage-2']));
  });

  it('fires Discord and social events (fire-and-forget)', async () => {
    const request = makeRequest({}) as NextRequest;
    await POST(request, { params: makeParams({ id: 's1' }) });

    expect(emitDiscordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'season_advanced',
        season_id: 's1',
        data: expect.objectContaining({
          season_name: 'Season One',
          advanced_count: 8,
        }),
      }),
    );
    expect(emitSocialEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'season_advanced' }),
    );
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getSeasonById).mockRejectedValue(new Error('DB down'));

    const request = makeRequest({}) as NextRequest;
    const response = await POST(request, { params: makeParams({ id: 's1' }) });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});
