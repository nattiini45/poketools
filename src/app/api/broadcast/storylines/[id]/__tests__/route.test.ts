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

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: vi.fn() },
}));

import { GET, PATCH, DELETE } from '@/app/api/broadcast/storylines/[id]/route';
import { requireCreator } from '@/lib/auth/helpers';
import { supabase } from '@/lib/supabase/client';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockPlayer = { playerId: 'creator-1', isAdmin: false, isCreator: true };

const mockStoryline = {
  id: 'story-1',
  season_id: 'season-1',
  title: 'Rivalry Begins',
  body: 'Two players clash in week 1.',
  tags: ['rivalry'],
  featured: false,
  created_by: 'creator-1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const routeParams = { params: Promise.resolve({ id: 'story-1' }) };

describe('GET /api/broadcast/storylines/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a single storyline', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: mockStoryline,
      error: null,
    });
    const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never);

    const request = {} as NextRequest;
    const res = await GET(request, routeParams);
    const body = await res.json();

    expect(body).toEqual({ success: true, data: mockStoryline });
    expect(supabase.from).toHaveBeenCalledWith('season_storylines');
  });

  it('returns 404 when storyline not found', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never);

    const request = {} as NextRequest;
    const res = await GET(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Not found', code: 'not_found_generic' });
  });

  it('delegates to safeErrorResponse on DB error', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });
    const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never);

    const request = {} as NextRequest;
    await GET(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});

describe('PATCH /api/broadcast/storylines/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates a storyline', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const mockSingle = vi.fn().mockResolvedValue({
      data: { ...mockStoryline, title: 'Updated' },
      error: null,
    });
    const mockSelect = vi.fn(() => ({ single: mockSingle }));
    const mockEq = vi.fn(() => ({ select: mockSelect }));
    const mockUpdate = vi.fn(() => ({ eq: mockEq }));
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never);

    const request = {
      json: vi.fn().mockResolvedValue({ title: 'Updated' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.title).toBe('Updated');
    expect(requireCreator).toHaveBeenCalled();
  });

  it('returns 400 with validation_failed for an empty update', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({}),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: body.error,
      code: 'validation_failed',
      params: { issues: body.error },
    });
    expect(body.error).toContain('At least one field');
  });

  it('delegates to safeErrorResponse when not creator', async () => {
    vi.mocked(requireCreator).mockRejectedValue(
      new (class extends Error {
        statusCode = 403;
        constructor() { super('Creator access required'); }
      })()
    );

    const request = {
      json: vi.fn().mockResolvedValue({ title: 'x' }),
    } as unknown as NextRequest;

    await PATCH(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('delegates to safeErrorResponse on DB error', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Not found' },
    });
    const mockSelect = vi.fn(() => ({ single: mockSingle }));
    const mockEq = vi.fn(() => ({ select: mockSelect }));
    const mockUpdate = vi.fn(() => ({ eq: mockEq }));
    vi.mocked(supabase.from).mockReturnValue({ update: mockUpdate } as never);

    const request = {
      json: vi.fn().mockResolvedValue({ title: 'x' }),
    } as unknown as NextRequest;

    await PATCH(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});

describe('DELETE /api/broadcast/storylines/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a storyline', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const mockEq = vi.fn().mockResolvedValue({ error: null });
    const mockDelete = vi.fn(() => ({ eq: mockEq }));
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never);

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(body).toEqual({ success: true });
    expect(supabase.from).toHaveBeenCalledWith('season_storylines');
  });

  it('delegates to safeErrorResponse when not creator', async () => {
    vi.mocked(requireCreator).mockRejectedValue(
      new (class extends Error {
        statusCode = 403;
        constructor() { super('Creator access required'); }
      })()
    );

    const request = {} as NextRequest;
    await DELETE(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('delegates to safeErrorResponse on DB error', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const mockEq = vi.fn().mockResolvedValue({
      error: { message: 'FK constraint' },
    });
    const mockDelete = vi.fn(() => ({ eq: mockEq }));
    vi.mocked(supabase.from).mockReturnValue({ delete: mockDelete } as never);

    const request = {} as NextRequest;
    await DELETE(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
