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
  getPresetById: vi.fn(),
  updatePreset: vi.fn(),
  deletePreset: vi.fn(),
}));

import { PATCH, DELETE } from '@/app/api/broadcast/presets/[id]/route';
import { requireCreator, AuthError } from '@/lib/auth/helpers';
import {
  getPresetById,
  updatePreset,
  deletePreset,
} from '@/lib/supabase/queries/broadcast-presets';
import { safeErrorResponse } from '@/lib/api/error-response';

const mockPlayer = { playerId: 'creator-1', isAdmin: false, isCreator: true };
const mockPreset = {
  id: 'preset-1',
  name: 'Default Overlay',
  owner_id: 'creator-1',
  preset_type: 'overlay',
  config: { theme: 'dark' },
  created_at: '2024-01-01T00:00:00Z',
};

const routeParams = { params: Promise.resolve({ id: 'preset-1' }) };

describe('PATCH /api/broadcast/presets/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates preset name and config as owner', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);
    vi.mocked(getPresetById).mockResolvedValue(mockPreset as never);
    vi.mocked(updatePreset).mockResolvedValue({
      ...mockPreset,
      name: 'Updated',
      config: { theme: 'light' },
    } as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        name: 'Updated',
        config: { theme: 'light' },
      }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Updated');
    expect(updatePreset).toHaveBeenCalledWith('preset-1', {
      name: 'Updated',
      config: { theme: 'light' },
    });
  });

  it('allows admin to update another user preset', async () => {
    const adminPlayer = { playerId: 'admin-1', isAdmin: true, isCreator: true };
    vi.mocked(requireCreator).mockResolvedValue(adminPlayer as never);
    vi.mocked(getPresetById).mockResolvedValue(mockPreset as never);
    vi.mocked(updatePreset).mockResolvedValue({
      ...mockPreset,
      name: 'Admin Updated',
    } as never);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Admin Updated' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
  });

  it('returns 404 when preset not found', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);
    vi.mocked(getPresetById).mockResolvedValue(null as never);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'x' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Preset not found', code: 'preset_not_found' });
  });

  it('returns 403 when non-owner non-admin tries to update', async () => {
    const otherPlayer = { playerId: 'other-1', isAdmin: false, isCreator: true };
    vi.mocked(requireCreator).mockResolvedValue(otherPlayer as never);
    vi.mocked(getPresetById).mockResolvedValue(mockPreset as never);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Hacked' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: 'Not authorized to update this preset',
      code: 'preset_update_forbidden',
    });
  });

  it('delegates to safeErrorResponse when not creator', async () => {
    vi.mocked(requireCreator).mockRejectedValue(
      new AuthError('Creator access required', 403)
    );

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'x' }),
    } as unknown as NextRequest;

    await PATCH(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});

describe('DELETE /api/broadcast/presets/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a preset as owner', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);
    vi.mocked(getPresetById).mockResolvedValue(mockPreset as never);
    vi.mocked(deletePreset).mockResolvedValue(undefined);

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(body).toEqual({ success: true, data: { deleted: true } });
    expect(deletePreset).toHaveBeenCalledWith('preset-1');
  });

  it('allows admin to delete another user preset', async () => {
    const adminPlayer = { playerId: 'admin-1', isAdmin: true, isCreator: true };
    vi.mocked(requireCreator).mockResolvedValue(adminPlayer as never);
    vi.mocked(getPresetById).mockResolvedValue(mockPreset as never);
    vi.mocked(deletePreset).mockResolvedValue(undefined);

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(body).toEqual({ success: true, data: { deleted: true } });
  });

  it('returns 404 when preset not found', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);
    vi.mocked(getPresetById).mockResolvedValue(null as never);

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Preset not found', code: 'preset_not_found' });
  });

  it('returns 403 when non-owner non-admin tries to delete', async () => {
    const otherPlayer = { playerId: 'other-1', isAdmin: false, isCreator: true };
    vi.mocked(requireCreator).mockResolvedValue(otherPlayer as never);
    vi.mocked(getPresetById).mockResolvedValue(mockPreset as never);

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({
      success: false,
      error: 'Not authorized to delete this preset',
      code: 'preset_delete_forbidden',
    });
  });

  it('delegates to safeErrorResponse on DB error', async () => {
    vi.mocked(requireCreator).mockResolvedValue(mockPlayer as never);
    vi.mocked(getPresetById).mockResolvedValue(mockPreset as never);
    vi.mocked(deletePreset).mockRejectedValue(new Error('FK constraint'));

    const request = {} as NextRequest;
    await DELETE(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
