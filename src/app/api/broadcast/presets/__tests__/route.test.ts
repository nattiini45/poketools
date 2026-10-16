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

vi.mock('@/lib/supabase/queries/broadcast-presets', () => ({
  getPresetsByOwner: vi.fn(),
  createPreset: vi.fn(),
}));

import { GET, POST } from '@/app/api/broadcast/presets/route';
import { requireCreator, AuthError } from '@/lib/auth/helpers';
import {
  getPresetsByOwner,
  createPreset,
} from '@/lib/supabase/queries/broadcast-presets';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockPlayer = { playerId: 'creator-1', isAdmin: false, isCreator: true };
const mockPreset = {
  id: 'preset-1',
  name: 'Default Overlay',
  owner_id: 'creator-1',
  preset_type: 'match',
  config: { theme: 'dark' },
  created_at: '2024-01-01T00:00:00Z',
};

describe('GET /api/broadcast/presets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns presets for the current creator', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);
    vi.mocked(getPresetsByOwner).mockResolvedValue([mockPreset as never]);

    const res = await GET();
    const body = await res.json();

    expect(requireCreator).toHaveBeenCalled();
    expect(body).toEqual({ success: true, data: [mockPreset] });
    expect(getPresetsByOwner).toHaveBeenCalledWith('creator-1');
  });

  it('delegates to safeErrorResponse when not creator', async () => {
    vi.mocked(requireCreator).mockRejectedValue(
      new AuthError('Creator access required', 403)
    );

    await GET();

    expect(safeErrorResponse).toHaveBeenCalled();
  });

  it('delegates to safeErrorResponse on DB error', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);
    vi.mocked(getPresetsByOwner).mockRejectedValue(new Error('DB error'));

    await GET();

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});

describe('POST /api/broadcast/presets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new preset', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);
    vi.mocked(createPreset).mockResolvedValue(mockPreset as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        name: 'Default Overlay',
        preset_type: 'match',
        config: { theme: 'dark' },
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(body).toEqual({ success: true, data: mockPreset });
    expect(createPreset).toHaveBeenCalledWith({
      name: 'Default Overlay',
      owner_id: 'creator-1',
      preset_type: 'match',
      config: { theme: 'dark' },
    });
  });

  it('returns 400 when name is missing', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        preset_type: 'match',
        config: { theme: 'dark' },
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('name');
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('returns 400 when preset_type is missing', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        name: 'Test',
        config: { theme: 'dark' },
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('preset_type');
  });

  it('returns 400 when config is missing', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        name: 'Test',
        preset_type: 'match',
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('config');
  });

  it('delegates to safeErrorResponse when not creator', async () => {
    vi.mocked(requireCreator).mockRejectedValue(
      new AuthError('Creator access required', 403)
    );

    const request = {
      json: vi.fn().mockResolvedValue({
        name: 'Test',
        preset_type: 'match',
        config: {},
      }),
    } as unknown as NextRequest;

    await POST(request);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
