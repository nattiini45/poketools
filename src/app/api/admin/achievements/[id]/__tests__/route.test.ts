import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { AchievementDefinition } from '@/types/achievement';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    requireAdmin: vi.fn(),
    AuthError,
  };
});

vi.mock('@/lib/supabase/queries/achievements', () => ({
  updateAchievementDefinition: vi.fn(),
  deleteAchievementDefinition: vi.fn(),
  getAchievementDefinition: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { PATCH, DELETE } from '@/app/api/admin/achievements/[id]/route';
import { revalidateTag } from 'next/cache';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import {
  updateAchievementDefinition,
  deleteAchievementDefinition,
  getAchievementDefinition,
} from '@/lib/supabase/queries/achievements';
import { logAuditEvent } from '@/lib/audit/log';

const adminPlayer = { playerId: 'admin-1', name: 'Admin' };

const mockAchievement: AchievementDefinition = {
  id: '389c86e5-4706-487a-87e1-ed8d2ff2f0e5',
  key: 'first_win',
  name: 'First Win',
  description: 'Win your first match',
  icon: null,
  category: 'combat',
  tier: 'bronze',
  repeatable: false,
  hidden: false,
  criteria: { type: 'cumulative' as const, stat: 'total_wins' as const, op: 'gte' as const, value: 1 },
};

const routeParams = { params: Promise.resolve({ id: '389c86e5-4706-487a-87e1-ed8d2ff2f0e5' }) };

describe('PATCH /api/admin/achievements/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates an achievement definition', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer as never);
    vi.mocked(updateAchievementDefinition).mockResolvedValue({
      ...mockAchievement,
      name: 'Updated Name',
    });

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Updated Name' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Updated Name');
    expect(updateAchievementDefinition).toHaveBeenCalledWith('389c86e5-4706-487a-87e1-ed8d2ff2f0e5', {
      name: 'Updated Name',
    });
    // Player profiles read the definitions from the public read cache (D37).
    expect(revalidateTag).toHaveBeenCalledWith('achievements', { expire: 0 });
  });

  it('writes an audit log entry on update', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer as never);
    vi.mocked(updateAchievementDefinition).mockResolvedValue({
      ...mockAchievement,
      name: 'Updated Name',
    });

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Updated Name' }),
    } as unknown as NextRequest;

    await PATCH(request, routeParams);

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.achievement.update',
        actor_id: 'admin-1',
        resource_type: 'achievement',
        resource_id: '389c86e5-4706-487a-87e1-ed8d2ff2f0e5',
        resource_name: 'first_win',
      }),
    );
  });

  it('returns 400 for invalid patch body', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({ key: '' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('key');
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('returns 400 for empty patch', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({}),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('At least one field');
  });

  it('returns 400 for invalid category in patch', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({ category: 'invalid' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('category');
  });

  it('returns 400 for invalid tier in patch', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({ tier: 'diamond' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('tier');
  });

  it('returns 400 for non-boolean repeatable', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({ repeatable: 'yes' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('repeatable');
  });

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'x' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Forbidden' });
  });

  it('returns 500 on DB error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer as never);
    vi.mocked(updateAchievementDefinition).mockRejectedValue(
      new Error('Not found')
    );

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'x' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Failed to update achievement definition' });
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/achievements/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes an achievement definition', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer as never);
    vi.mocked(deleteAchievementDefinition).mockResolvedValue(undefined);

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(body).toEqual({ success: true, data: null });
    expect(deleteAchievementDefinition).toHaveBeenCalledWith('389c86e5-4706-487a-87e1-ed8d2ff2f0e5');
    expect(revalidateTag).toHaveBeenCalledWith('achievements', { expire: 0 });
  });

  it('writes an audit log entry on delete', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer as never);
    vi.mocked(getAchievementDefinition).mockResolvedValue(mockAchievement);
    vi.mocked(deleteAchievementDefinition).mockResolvedValue(undefined);

    const request = {} as NextRequest;
    await DELETE(request, routeParams);

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.achievement.delete',
        actor_id: 'admin-1',
        resource_type: 'achievement',
        resource_id: '389c86e5-4706-487a-87e1-ed8d2ff2f0e5',
        resource_name: 'first_win',
      }),
    );
  });

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Forbidden' });
  });

  it('returns 500 on DB error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminPlayer as never);
    vi.mocked(deleteAchievementDefinition).mockRejectedValue(
      new Error('FK constraint')
    );

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Failed to delete achievement definition' });
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
