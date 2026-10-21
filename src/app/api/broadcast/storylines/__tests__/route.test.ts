import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    requireCreator: vi.fn(),
    AuthError,
  };
});

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/client', () => {
  const mockSingle = vi.fn();
  const mockOrder2 = vi.fn(() => ({ data: [], error: null }));
  const mockOrder1 = vi.fn(() => ({ order: mockOrder2 }));
  const mockEq = vi.fn(() => ({ order: mockOrder1 }));
  const mockSelect = vi.fn(() => ({ eq: mockEq, single: mockSingle }));
  const mockInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: mockSingle })) }));
  const mockFrom = vi.fn(() => ({ select: mockSelect, insert: mockInsert }));
  return {
    supabase: { from: mockFrom },
  };
});

import { GET, POST } from '@/app/api/broadcast/storylines/route';
import { requireCreator } from '@/lib/auth/helpers';
import { supabase } from '@/lib/supabase/client';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockPlayer = { playerId: 'creator-1', isAdmin: false, isCreator: true };

const mockStoryline = {
  id: 'story-1',
  season_id: '00000000-0000-4000-8000-000000000001',
  title: 'Rivalry Begins',
  body: 'Two players clash in week 1.',
  tags: ['rivalry'],
  featured: false,
  created_by: 'creator-1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

describe('GET /api/broadcast/storylines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns storylines for a season', async () => {
    const mockOrder2 = vi.fn().mockResolvedValue({
      data: [mockStoryline],
      error: null,
    });
    const mockOrder1 = vi.fn(() => ({ order: mockOrder2 }));
    const mockEq = vi.fn(() => ({ order: mockOrder1 }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    vi.mocked(supabase.from).mockReturnValue({
      select: mockSelect,
    } as never);

    const url = new URL(
      'http://localhost:3000/api/broadcast/storylines?season_id=00000000-0000-4000-8000-000000000001'
    );
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request);
    const body = await res.json();

    expect(body).toEqual({ success: true, data: [mockStoryline] });
    expect(supabase.from).toHaveBeenCalledWith('season_storylines');
  });

  it('returns 400 when season_id missing', async () => {
    const url = new URL('http://localhost:3000/api/broadcast/storylines');
    const request = { nextUrl: url } as unknown as NextRequest;

    const res = await GET(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'season_id required', code: 'storyline_season_id_required' });
  });

  it('delegates to safeErrorResponse on DB error', async () => {
    const mockOrder2 = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });
    const mockOrder1 = vi.fn(() => ({ order: mockOrder2 }));
    const mockEq = vi.fn(() => ({ order: mockOrder1 }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    vi.mocked(supabase.from).mockReturnValue({
      select: mockSelect,
    } as never);

    const url = new URL(
      'http://localhost:3000/api/broadcast/storylines?season_id=00000000-0000-4000-8000-000000000001'
    );
    const request = { nextUrl: url } as unknown as NextRequest;

    await GET(request);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});

describe('POST /api/broadcast/storylines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a storyline', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const mockSingle = vi.fn().mockResolvedValue({
      data: mockStoryline,
      error: null,
    });
    const mockSelectAfterInsert = vi.fn(() => ({ single: mockSingle }));
    const mockInsert = vi.fn(() => ({ select: mockSelectAfterInsert }));
    vi.mocked(supabase.from).mockReturnValue({
      insert: mockInsert,
    } as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-8000-000000000001',
        title: 'Rivalry Begins',
        body: 'Two players clash in week 1.',
        tags: ['rivalry'],
        featured: false,
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ success: true, data: mockStoryline });
    expect(mockInsert).toHaveBeenCalledWith({
      season_id: '00000000-0000-4000-8000-000000000001',
      title: 'Rivalry Begins',
      body: 'Two players clash in week 1.',
      tags: ['rivalry'],
      featured: false,
      created_by: 'creator-1',
    });
  });

  it('returns 400 when title missing', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-8000-000000000001',
        body: 'content',
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('returns 400 when body missing', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-8000-000000000001',
        title: 'Title',
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('returns 400 when season_id missing', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        title: 'Title',
        body: 'content',
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('defaults tags to empty array and featured to false', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const mockSingle = vi.fn().mockResolvedValue({
      data: { ...mockStoryline, tags: [], featured: false },
      error: null,
    });
    const mockSelectAfterInsert = vi.fn(() => ({ single: mockSingle }));
    const mockInsert = vi.fn(() => ({ select: mockSelectAfterInsert }));
    vi.mocked(supabase.from).mockReturnValue({
      insert: mockInsert,
    } as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-8000-000000000001',
        title: 'Title',
        body: 'content',
      }),
    } as unknown as NextRequest;

    await POST(request);

    expect(mockInsert).toHaveBeenCalledWith({
      season_id: '00000000-0000-4000-8000-000000000001',
      title: 'Title',
      body: 'content',
      tags: [],
      featured: false,
      created_by: 'creator-1',
    });
  });
});
