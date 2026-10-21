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
  listAchievementDefinitions: vi.fn(),
  createAchievementDefinition: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { GET, POST } from '@/app/api/admin/achievements/route';
import { revalidateTag } from 'next/cache';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import {
  listAchievementDefinitions,
  createAchievementDefinition,
} from '@/lib/supabase/queries/achievements';

const mockAchievement: AchievementDefinition = {
  id: 'ach-1',
  key: 'first_win',
  name: 'First Win',
  description: 'Win your first match',
  icon: null,
  category: 'combat',
  tier: 'bronze',
  repeatable: false,
  hidden: false,
  criteria: { type: 'cumulative', stat: 'total_wins', op: 'gte', value: 1 },
};

const mockAdmin = {
  playerId: 'p-1',
  name: 'Admin User',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: 'admin',
  championsUsername: null,
  avatarUrl: null,
};

describe('GET /api/admin/achievements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns list of achievement definitions', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(listAchievementDefinitions).mockResolvedValue([mockAchievement]);

    const res = await GET();
    const body = await res.json();

    expect(requireAdmin).toHaveBeenCalled();
    expect(body).toEqual({ success: true, data: [mockAchievement] });
  });

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Forbidden' });
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(listAchievementDefinitions).mockRejectedValue(new Error('DB error'));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: 'Failed to fetch achievement definitions',
    });
  });
});

describe('POST /api/admin/achievements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validBody = {
    key: 'first_win',
    name: 'First Win',
    description: 'Win your first match',
    icon: null,
    category: 'combat',
    tier: 'bronze',
    repeatable: false,
    hidden: false,
    criteria: { type: 'wins', threshold: 1 },
  };

  it('creates an achievement definition', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(createAchievementDefinition).mockResolvedValue(mockAchievement);

    const request = {
      json: vi.fn().mockResolvedValue(validBody),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ success: true, data: mockAchievement });
    expect(createAchievementDefinition).toHaveBeenCalledWith({
      key: 'first_win',
      name: 'First Win',
      description: 'Win your first match',
      icon: null,
      category: 'combat',
      tier: 'bronze',
      repeatable: false,
      hidden: false,
      criteria: { type: 'wins', threshold: 1 },
    });
    // Player profiles read the definitions from the public read cache (D37).
    expect(revalidateTag).toHaveBeenCalledWith('achievements', { expire: 0 });
  });

  it('returns 400 for missing required fields', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const request = {
      json: vi.fn().mockResolvedValue({ key: 'x' }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('name');
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('returns 400 for invalid category', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        ...validBody,
        category: 'invalid',
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('category');
  });

  it('returns 400 for invalid tier', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        ...validBody,
        tier: 'diamond',
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('tier');
  });

  it('returns 400 when criteria is missing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        ...validBody,
        criteria: null,
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('criteria');
  });

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const request = {
      json: vi.fn().mockResolvedValue(validBody),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Forbidden' });
  });

  it('returns 500 on DB error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(createAchievementDefinition).mockRejectedValue(
      new Error('Duplicate key')
    );

    const request = {
      json: vi.fn().mockResolvedValue(validBody),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Failed to create achievement definition' });
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});