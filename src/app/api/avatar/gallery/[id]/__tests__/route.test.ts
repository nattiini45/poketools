import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

import type { AvatarGalleryChoices } from '@/types/avatar';

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string, status = 500, code?: string) =>
    NextResponse.json({ success: false, error: fallback, code }, { status })),
}));

vi.mock('@/lib/supabase/queries/avatar-gallery', () => ({
  getGalleryItem: vi.fn(),
  deleteGalleryItem: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    storage: {
      from: vi.fn().mockReturnValue({
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  },
}));

import { DELETE } from '@/app/api/avatar/gallery/[id]/route';
import { requireAuth } from '@/lib/auth/helpers';
import {
  getGalleryItem,
  deleteGalleryItem,
} from '@/lib/supabase/queries/avatar-gallery';
import { supabase } from '@/lib/supabase/client';

const SESSION_WITH_PLAYER = {
  expires: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: 'u1' },
  player: { playerId: 'p1' },
};

const SESSION_NO_PLAYER = {
  expires: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: 'u1' },
  player: null,
};

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const dummyRequest = {} as NextRequest;

describe('DELETE /api/avatar/gallery/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when player is not registered', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_NO_PLAYER);

    const res = await DELETE(dummyRequest, makeParams('g1'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Player registration required');
    expect(body.code).toBe('player_registration_required');
  });

  it('returns 404 when gallery item not found', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_WITH_PLAYER as never);
    vi.mocked(getGalleryItem).mockResolvedValue(null);

    const res = await DELETE(dummyRequest, makeParams('g1'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Gallery item not found');
    expect(body.code).toBe('gallery_item_not_found');
  });

  it('returns 403 when deleting another player\'s item', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_WITH_PLAYER as never);
    vi.mocked(getGalleryItem).mockResolvedValue({
      id: 'g1',
      player_id: 'p2',
      image_url: 'https://example.com/img.png',
      choices: { type: 'photo_transform' } as AvatarGalleryChoices,
      style: 'anime',
      created_at: '2026-01-01T00:00:00.000Z',
    });

    const res = await DELETE(dummyRequest, makeParams('g1'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("another player's");
    expect(body.code).toBe('gallery_item_delete_forbidden');
  });

  it('deletes gallery item and storage file on success', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_WITH_PLAYER as never);
    vi.mocked(getGalleryItem).mockResolvedValue({
      id: 'g1',
      player_id: 'p1',
      image_url: 'https://xyz.supabase.co/storage/v1/object/public/avatars/gallery/p1/file.png',
      choices: { type: 'photo_transform' } as AvatarGalleryChoices,
      style: 'anime',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(deleteGalleryItem).mockResolvedValue(true);

    const mockRemove = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(supabase.storage.from).mockReturnValue({
      remove: mockRemove,
    } as unknown as unknown as unknown as unknown as ReturnType<typeof supabase.storage.from>);

    const res = await DELETE(dummyRequest, makeParams('g1'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('g1');
    expect(mockRemove).toHaveBeenCalledWith(['gallery/p1/file.png']);
    expect(vi.mocked(deleteGalleryItem)).toHaveBeenCalledWith('g1', 'p1');
  });

  it('returns 404 when deleteGalleryItem returns false', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_WITH_PLAYER as never);
    vi.mocked(getGalleryItem).mockResolvedValue({
      id: 'g1',
      player_id: 'p1',
      image_url: 'https://example.com/no-marker.png',
      choices: { type: 'photo_transform' } as AvatarGalleryChoices,
      style: 'anime',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(deleteGalleryItem).mockResolvedValue(false);

    const res = await DELETE(dummyRequest, makeParams('g1'));
    expect(res.status).toBe(404);
  });

  it('still deletes DB record if storage path cannot be extracted', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_WITH_PLAYER as never);
    vi.mocked(getGalleryItem).mockResolvedValue({
      id: 'g1',
      player_id: 'p1',
      image_url: 'https://example.com/no-marker-path.png',
      choices: { type: 'photo_transform' } as AvatarGalleryChoices,
      style: 'anime',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(deleteGalleryItem).mockResolvedValue(true);

    const res = await DELETE(dummyRequest, makeParams('g1'));
    const body = await res.json();
    expect(body.success).toBe(true);
    // Storage remove should NOT be called since path extraction fails
    expect(vi.mocked(supabase.storage.from)).not.toHaveBeenCalled();
  });

  it('returns safeErrorResponse on unexpected error', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('boom'));

    const res = await DELETE(dummyRequest, makeParams('g1'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to delete gallery item');
    expect(body.code).toBe('gallery_item_delete_failed');
  });
});
