import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import sharp from 'sharp';
import type { AvatarGalleryChoices } from '@/types/avatar';
import {
  TEST_AVATAR_PUBLIC_BASE,
  TEST_SUPABASE_URL,
  createFakeAvatarBucket,
  makeTestJpeg,
  makeTestPng,
  publicAvatarUrl,
  toDataUrl,
} from '@/lib/avatar/__tests__/avatar-test-helpers';

// ── Mocks ──────────────────────────────────────────────────────────────

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

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerById: vi.fn(),
  updatePlayer: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/avatar-gallery', () => ({
  getGalleryItem: vi.fn(),
}));

// The storage mock hands out whichever in-memory bucket the current test installed.
const storage = vi.hoisted(() => ({ bucket: null as unknown }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => storage.bucket),
    },
  },
}));

vi.mock('@/lib/avatar/manifest', () => ({
  validateAvatarConfig: vi.fn().mockReturnValue([]),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { POST, DELETE } from '../route';
import { revalidateTag } from 'next/cache';
import { requireAuth } from '@/lib/auth/helpers';
import { getPlayerById, updatePlayer } from '@/lib/supabase/queries/players';
import { getGalleryItem } from '@/lib/supabase/queries/avatar-gallery';
import { validateAvatarConfig } from '@/lib/avatar/manifest';
import { legacyPlayerAvatarPaths } from '@/lib/avatar/thumbnail';
import { safeErrorResponse } from '@/lib/api/error-response';
import { SupabaseTimeoutError } from '@/lib/supabase/timeout-fetch';

// ── Fixtures ───────────────────────────────────────────────────────────

/** A UUID like every real player id: storage names must pass the original-path whitelist. */
const PLAYER_ID = '10000000-0000-4000-8000-000000000001';

const OWN_SESSION = {
  expires: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: 'user-1' },
  player: {
    playerId: PLAYER_ID,
    isAdmin: false,
    status: 'active' as const,
  },
};

const ADMIN_SESSION = {
  expires: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: 'user-admin' },
  player: {
    playerId: 'player-admin',
    isAdmin: true,
  },
};

const OTHER_SESSION = {
  expires: new Date(Date.now() + 86_400_000).toISOString(),
  user: { id: 'user-other' },
  player: {
    playerId: 'player-other',
    isAdmin: false,
    status: 'active' as const,
  },
};

const MOCK_PLAYER = {
  id: PLAYER_ID,
  name: 'Alice',
  discord_id: 'disc-1',
  auth_user_id: null,
  ps_username: '',
  champions_username: '',
  is_admin: false,
  is_creator: false,
  is_test_account: false,
  is_guest: false,
  joined_date: '2026-01-01',
  avatar_url: null as string | null,
  avatar_config: null,
  status: 'active' as const,
  suspended_until: null,
  ban_reason: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const MOCK_UPDATED_PLAYER = {
  ...MOCK_PLAYER,
  avatar_url: `https://storage.example.com/avatars/${PLAYER_ID}.png`,
};

const GALLERY_ORIGINAL_PATH = `gallery/${PLAYER_ID}/00000000-0000-4000-8000-00000000000a.png`;
const GALLERY_ID = '00000000-0000-4000-8000-000000000001';
const HASHED_PATH_RE = new RegExp(`^${PLAYER_ID}\\.[0-9a-f]{16}\\.png$`);
/** 16 bytes with a PNG signature: passes the magic-byte check but does not decode. */
const FAKE_PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

/** 1024 px AI-sized image (over the 500 KB layer-built limit, under 5 MB). */
let realPng: Buffer;
/** 160 px layer-built image. */
let layerPng: Buffer;
let realJpeg: Buffer;
let fake: ReturnType<typeof createFakeAvatarBucket>;

function makeRouteParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

function galleryItem(overrides: Partial<{ player_id: string; image_url: string }> = {}) {
  return {
    id: 'gallery-1',
    player_id: PLAYER_ID,
    image_url: publicAvatarUrl(GALLERY_ORIGINAL_PATH),
    choices: { type: 'photo_transform' } as AvatarGalleryChoices,
    style: 'anime',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function uploadCall(index: number): [string, Buffer, Record<string, unknown>] {
  return fake.api.upload.mock.calls[index] as unknown as [string, Buffer, Record<string, unknown>];
}

beforeAll(async () => {
  realPng = await makeTestPng(1024, 1024);
  layerPng = await makeTestPng(160, 160);
  realJpeg = await makeTestJpeg(600, 400);
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', TEST_SUPABASE_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ── POST tests ─────────────────────────────────────────────────────────

describe('POST /api/players/[id]/avatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake = createFakeAvatarBucket();
    storage.bucket = fake.api;
    vi.mocked(requireAuth).mockResolvedValue(OWN_SESSION as never);
    vi.mocked(getPlayerById).mockResolvedValue({ ...MOCK_PLAYER });
    vi.mocked(updatePlayer).mockResolvedValue(MOCK_UPDATED_PLAYER);
    vi.mocked(validateAvatarConfig).mockReturnValue([]);
  });

  // ── Authorization ──────────────────────────────────────────────

  it('returns 403 when editing another player avatar as non-admin', async () => {
    vi.mocked(requireAuth).mockResolvedValue(OTHER_SESSION as never);

    const req = makeRequest({ image: 'data:image/png;base64,abc', config: { gender: 'male' } });
    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Not authorized to edit this avatar');
    expect(json.code).toBe('avatar_edit_forbidden');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('allows admin to edit any player avatar', async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN_SESSION as never);

    const req = makeRequest({
      showdown_sprite: 'red',
      sprite_url: 'https://play.pokemonshowdown.com/sprites/trainers/red.png',
    });
    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(json.success).toBe(true);
  });

  it('returns 404 when player does not exist', async () => {
    vi.mocked(getPlayerById).mockResolvedValue(null);

    const req = makeRequest({ image: 'data:image/png;base64,abc', config: { gender: 'male' } });
    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Player not found');
    expect(json.code).toBe('player_not_found');
  });

  // ── Showdown sprite shortcut ───────────────────────────────────

  it('sets Showdown sprite as avatar', async () => {
    const req = makeRequest({
      showdown_sprite: 'red',
      sprite_url: 'https://play.pokemonshowdown.com/sprites/trainers/red.png',
    });

    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(updatePlayer).toHaveBeenCalledWith(PLAYER_ID, {
      avatar_url: 'https://play.pokemonshowdown.com/sprites/trainers/red.png',
      avatar_config: { type: 'showdown', spriteId: 'red' },
    });
    expect(fake.api.upload).not.toHaveBeenCalled();
    // Cached public reads that embed avatars are expired at once (D37).
    expect(revalidateTag).toHaveBeenCalledWith('players', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(`player:${PLAYER_ID}`, { expire: 0 });
  });

  it('rejects non-Showdown sprite URLs', async () => {
    const req = makeRequest({
      showdown_sprite: 'red',
      sprite_url: 'https://evil.com/sprites/red.png',
    });

    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid Showdown sprite URL');
    expect(json.code).toBe('showdown_sprite_url_invalid');
  });

  it.each([
    [
      'the Showdown-prefixed traversal (security verifier blocker 2)',
      'https://play.pokemonshowdown.com/sprites/trainers/x/storage/v1/object/public/avatars/..%2Fworld-assets%2Fx.png',
    ],
    ['an encoded traversal', 'https://play.pokemonshowdown.com/sprites/trainers/..%2F..%2Fx.png'],
    ['a nested path', 'https://play.pokemonshowdown.com/sprites/trainers/x/red.png'],
    ['plain http', 'http://play.pokemonshowdown.com/sprites/trainers/red.png'],
    ['a look-alike host', 'https://play.pokemonshowdown.com.evil.com/sprites/trainers/red.png'],
    ['credentials', 'https://user@play.pokemonshowdown.com/sprites/trainers/red.png'],
    ['a port', 'https://play.pokemonshowdown.com:444/sprites/trainers/red.png'],
    ['a query string', 'https://play.pokemonshowdown.com/sprites/trainers/red.png?x=1'],
    ['a fragment', 'https://play.pokemonshowdown.com/sprites/trainers/red.png#x'],
    ['a different sprite than showdown_sprite', 'https://play.pokemonshowdown.com/sprites/trainers/blue.png'],
    ['this project\'s avatars bucket', `${TEST_AVATAR_PUBLIC_BASE}/gallery/${PLAYER_ID}/00000000-0000-4000-8000-00000000000a.png`],
  ])('returns 400 for a sprite_url with %s, writing nothing', async (_label, spriteUrl) => {
    const res = await POST(makeRequest({ showdown_sprite: 'red', sprite_url: spriteUrl }), makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid Showdown sprite URL');
    expect(json.code).toBe('showdown_sprite_url_invalid');
    expect(updatePlayer).not.toHaveBeenCalled();
    expect(fake.api.exists).not.toHaveBeenCalled();
    expect(fake.api.download).not.toHaveBeenCalled();
    expect(fake.api.upload).not.toHaveBeenCalled();
    expect(fake.api.remove).not.toHaveBeenCalled();
  });

  it.each([
    ['upper case', 'Red'],
    ['a path', '../red'],
    ['an encoded slash', 'red%2F..'],
    ['too long', 'a'.repeat(65)],
  ])('returns 400 for a showdown_sprite id with %s', async (_label, spriteId) => {
    const res = await POST(
      makeRequest({ showdown_sprite: spriteId, sprite_url: 'https://play.pokemonshowdown.com/sprites/trainers/red.png' }),
      makeRouteParams(PLAYER_ID),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid Showdown sprite id');
    expect(json.code).toBe('showdown_sprite_invalid');
    expect(updatePlayer).not.toHaveBeenCalled();
  });

  it('stores the canonical sprite URL, not the raw string', async () => {
    await POST(makeRequest({
      showdown_sprite: 'red',
      sprite_url: 'HTTPS://PLAY.POKEMONSHOWDOWN.COM/sprites/trainers/red.png',
    }), makeRouteParams(PLAYER_ID));

    expect(updatePlayer).toHaveBeenCalledWith(PLAYER_ID, expect.objectContaining({
      avatar_url: 'https://play.pokemonshowdown.com/sprites/trainers/red.png',
    }));
  });

  // ── Gallery image reuse ────────────────────────────────────────

  it('never touches Storage for a gallery image_url that fails the origin or path checks', async () => {
    vi.mocked(getGalleryItem).mockResolvedValue(galleryItem({
      image_url: `${TEST_AVATAR_PUBLIC_BASE}/..%2Fworld-assets%2Fx.png`,
    }));

    await POST(makeRequest({ gallery_id: GALLERY_ID }), makeRouteParams(PLAYER_ID));

    expect(fake.api.exists).not.toHaveBeenCalled();
    expect(fake.api.download).not.toHaveBeenCalled();
    expect(fake.api.upload).not.toHaveBeenCalled();
  });

  it('keeps a non-bucket gallery URL as avatar_url', async () => {
    vi.mocked(getGalleryItem).mockResolvedValue(galleryItem({ image_url: 'https://storage.example.com/gallery/img.png' }));

    const req = makeRequest({ gallery_id: GALLERY_ID });
    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(updatePlayer).toHaveBeenCalledWith(PLAYER_ID, {
      avatar_url: 'https://storage.example.com/gallery/img.png',
      avatar_config: { type: 'ai', gallery_id: GALLERY_ID },
    });
  });

  it('points avatar_url at the gallery thumbnail when it already exists', async () => {
    fake.objects.set(GALLERY_ORIGINAL_PATH, realPng);
    fake.objects.set(`${GALLERY_ORIGINAL_PATH}.thumb.webp`, Buffer.from('thumb'));
    vi.mocked(getGalleryItem).mockResolvedValue(galleryItem());

    const res = await POST(makeRequest({ gallery_id: GALLERY_ID }), makeRouteParams(PLAYER_ID));

    expect((await res.json()).success).toBe(true);
    expect(updatePlayer).toHaveBeenCalledWith(PLAYER_ID, {
      avatar_url: publicAvatarUrl(`${GALLERY_ORIGINAL_PATH}.thumb.webp`),
      avatar_config: { type: 'ai', gallery_id: GALLERY_ID },
    });
    expect(fake.api.download).not.toHaveBeenCalled();
    expect(fake.api.upload).not.toHaveBeenCalled();
  });

  it('creates a missing gallery thumbnail on first use and points avatar_url at it', async () => {
    fake.objects.set(GALLERY_ORIGINAL_PATH, realPng);
    vi.mocked(getGalleryItem).mockResolvedValue(galleryItem());

    await POST(makeRequest({ gallery_id: GALLERY_ID }), makeRouteParams(PLAYER_ID));

    const [path, body, options] = uploadCall(0);
    expect(path).toBe(`${GALLERY_ORIGINAL_PATH}.thumb.webp`);
    expect(options).toEqual({ contentType: 'image/webp', cacheControl: '31536000', upsert: false });
    expect((await sharp(body).metadata()).format).toBe('webp');
    expect(updatePlayer).toHaveBeenCalledWith(PLAYER_ID, expect.objectContaining({
      avatar_url: publicAvatarUrl(`${GALLERY_ORIGINAL_PATH}.thumb.webp`),
    }));
  });

  it('falls back to the original (and logs the stage) when the gallery thumbnail cannot be made', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getGalleryItem).mockResolvedValue(galleryItem()); // original missing → download fails

    const res = await POST(makeRequest({ gallery_id: GALLERY_ID }), makeRouteParams(PLAYER_ID));

    expect((await res.json()).success).toBe(true);
    expect(updatePlayer).toHaveBeenCalledWith(PLAYER_ID, expect.objectContaining({
      avatar_url: publicAvatarUrl(GALLERY_ORIGINAL_PATH),
    }));
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Gallery avatar thumbnail failed at download'),
      expect.anything(),
    );
  });

  it('returns 404 when gallery item does not exist', async () => {
    vi.mocked(getGalleryItem).mockResolvedValue(null);

    const req = makeRequest({ gallery_id: '00000000-0000-4000-8000-000000000002' });
    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Gallery item not found');
    expect(json.code).toBe('gallery_item_not_found');
  });

  it('returns 403 when using another player gallery item', async () => {
    vi.mocked(getGalleryItem).mockResolvedValue(galleryItem({
      player_id: 'player-other',
      image_url: 'https://storage.example.com/gallery/stolen.png',
    }));

    const req = makeRequest({ gallery_id: GALLERY_ID });
    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain("another player's gallery image");
    expect(json.code).toBe('gallery_item_not_owned');
  });

  // ── Standard avatar upload ─────────────────────────────────────

  it('uploads the original under a content-hashed name with a 1-year cache', async () => {
    const req = makeRequest({
      image: toDataUrl('image/png', layerPng),
      config: { gender: 'male', skin: 1, hair: 2 },
    });

    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(json.success).toBe(true);
    const [path, body, options] = uploadCall(0);
    expect(path).toMatch(HASHED_PATH_RE);
    expect(body.equals(layerPng)).toBe(true);
    expect(options).toEqual({ contentType: 'image/png', cacheControl: '31536000', upsert: true });
  });

  it('writes a 256 px WebP thumbnail (≤ 30 KB) next to the original', async () => {
    const req = makeRequest({ image: toDataUrl('image/png', realPng), config: {} });

    await POST(req, makeRouteParams(PLAYER_ID));

    const [originalPath] = uploadCall(0);
    const [thumbPath, thumb, options] = uploadCall(1);
    expect(thumbPath).toBe(`${originalPath}.thumb.webp`);
    expect(options).toEqual({ contentType: 'image/webp', cacheControl: '31536000', upsert: false });

    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(256);
    expect(thumb.length).toBeLessThanOrEqual(30 * 1024);
  });

  it('points avatar_url at the thumbnail, not the original', async () => {
    await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));

    const [originalPath] = uploadCall(0);
    expect(updatePlayer).toHaveBeenCalledWith(PLAYER_ID, {
      avatar_url: publicAvatarUrl(`${originalPath}.thumb.webp`),
      avatar_config: {},
    });
  });

  it('gives a new image a new name, so the long cache cannot serve a stale avatar', async () => {
    await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));
    await POST(makeRequest({ image: toDataUrl('image/png', await makeTestPng(512, 512)), config: {} }), makeRouteParams(PLAYER_ID));

    const first = uploadCall(0)[0];
    const second = uploadCall(2)[0];
    expect(first).toMatch(HASHED_PATH_RE);
    expect(second).toMatch(HASHED_PATH_RE);
    expect(second).not.toBe(first);
  });

  it('stores JPEG uploads with a .jpg original', async () => {
    await POST(makeRequest({ image: toDataUrl('image/jpeg', realJpeg), config: { gender: 'male' } }), makeRouteParams(PLAYER_ID));

    const [path, , options] = uploadCall(0);
    expect(path).toMatch(new RegExp(`^${PLAYER_ID}\\.[0-9a-f]{16}\\.jpg$`));
    expect(options).toEqual(expect.objectContaining({ contentType: 'image/jpeg' }));
  });

  it('returns 400 when the image passes the magic-byte check but cannot be decoded', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(
      makeRequest({ image: toDataUrl('image/png', FAKE_PNG_HEADER), config: { gender: 'male' } }),
      makeRouteParams(PLAYER_ID),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Avatar image could not be processed');
    expect(json.code).toBe('avatar_image_unprocessable');
    expect(fake.api.upload).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it('returns 400 when image and config are missing', async () => {
    const req = makeRequest({});
    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Must provide');
    expect(json.code).toBe('validation_failed');
  });

  it('validates avatar config against manifest', async () => {
    vi.mocked(validateAvatarConfig).mockReturnValue(['Invalid skin tone']);

    const req = makeRequest({
      image: toDataUrl('image/png', layerPng),
      config: { gender: 'male', skin: 99 },
    });

    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid avatar config');
    expect(json.code).toBe('avatar_config_invalid');
  });

  it('rejects a layer-built image over 500 KB with avatar_image_too_large and its max param', async () => {
    const res = await POST(
      makeRequest({ image: toDataUrl('image/png', realPng), config: { gender: 'male' } }),
      makeRouteParams(PLAYER_ID),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Avatar image too large (max 500KB)');
    expect(json).toMatchObject({ code: 'avatar_image_too_large', params: { max: '500KB' } });
  });

  it('returns 500 when storage upload fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.api.upload.mockResolvedValueOnce({ data: null, error: { message: 'Storage full', statusCode: '500', status: 500 } });

    const req = makeRequest({ image: toDataUrl('image/png', layerPng), config: { gender: 'male' } });
    const res = await POST(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to upload avatar');
    expect(json.code).toBe('avatar_upload_failed');
    expect(updatePlayer).not.toHaveBeenCalled();
  });

  it('a Storage request deadline on the upload goes to safeErrorResponse, which maps it to 504 upstream_timeout', async () => {
    const timeout = new SupabaseTimeoutError('storage', 'POST', '/storage/v1/object/avatars/x.png', 30_000, null);
    // storage-js wraps a thrown fetch as StorageUnknownError, the original under `originalError`.
    const storageError = { name: 'StorageUnknownError', message: timeout.message, statusCode: '500', status: 500, originalError: timeout };
    fake.api.upload.mockResolvedValueOnce({ data: null, error: storageError });

    const req = makeRequest({ image: toDataUrl('image/png', layerPng), config: { gender: 'male' } });
    await POST(req, makeRouteParams(PLAYER_ID));

    expect(safeErrorResponse).toHaveBeenCalledWith(storageError, 'Failed to upload avatar');
    expect(updatePlayer).not.toHaveBeenCalled();
    // The real helper (mocked above for routing) answers exactly that error with the catalogued 504.
    const real = await vi.importActual<typeof import('@/lib/api/error-response')>('@/lib/api/error-response');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mapped = real.safeErrorResponse(storageError, 'Failed to upload avatar');
    expect(mapped.status).toBe(504);
    expect(await mapped.json()).toMatchObject({ success: false, code: 'upstream_timeout' });
  });

  it('a Storage request deadline on the thumbnail still rolls back the original, then goes to safeErrorResponse', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const timeout = new SupabaseTimeoutError('storage', 'POST', '/storage/v1/object/avatars/x.webp', 30_000, null);
    const thumbError = { name: 'StorageUnknownError', message: timeout.message, statusCode: '500', status: 500, originalError: timeout };
    fake.api.upload
      .mockImplementationOnce(async (path: string, body: Buffer) => {
        fake.objects.set(path, body);
        return { data: { path }, error: null };
      })
      .mockResolvedValueOnce({ data: null, error: thumbError });

    await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));

    const [originalPath] = uploadCall(0);
    expect(fake.api.remove).toHaveBeenCalledWith([originalPath]);
    const [err, fallback] = vi.mocked(safeErrorResponse).mock.calls.at(-1)!;
    expect(fallback).toBe('Failed to upload avatar thumbnail');
    expect((err as Error).cause).toBe(thumbError);
    expect(updatePlayer).not.toHaveBeenCalled();
  });

  it('returns a distinct 500 and removes the new original when the thumbnail upload fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.api.upload
      .mockImplementationOnce(async (path: string, body: Buffer) => {
        fake.objects.set(path, body);
        return { data: { path }, error: null };
      })
      .mockResolvedValueOnce({ data: null, error: { message: 'Storage full', statusCode: '500', status: 500 } });

    const res = await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));
    const json = await res.json();

    const [originalPath] = uploadCall(0);
    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to upload avatar thumbnail');
    expect(json.code).toBe('avatar_thumbnail_upload_failed');
    expect(fake.api.remove).toHaveBeenCalledWith([originalPath]);
    expect(fake.objects.has(originalPath)).toBe(false);
    expect(updatePlayer).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('[API] Avatar thumbnail upload failed:', expect.anything());
  });

  it('removes the new original and thumbnail when the player update fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(updatePlayer).mockRejectedValue(new Error('db down'));

    const res = await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));
    const json = await res.json();

    const [originalPath] = uploadCall(0);
    const thumbPath = `${originalPath}.thumb.webp`;
    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to upload avatar');
    expect(json.code).toBe('avatar_upload_failed');
    // Content-hashed names are never named by the stale-file cleanup, so a failed save must not leave them.
    expect(fake.api.remove).toHaveBeenCalledWith([originalPath, thumbPath]);
    expect(fake.objects.has(originalPath)).toBe(false);
    expect(fake.objects.has(thumbPath)).toBe(false);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Unsaved avatar upload'), expect.anything());
  });

  it('keeps the uploaded objects when the current avatar is that same image', async () => {
    // First upload succeeds; the row now names its thumbnail.
    await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));
    const [originalPath] = uploadCall(0);
    const thumbPath = `${originalPath}.thumb.webp`;
    vi.mocked(getPlayerById).mockResolvedValue({ ...MOCK_PLAYER, avatar_url: publicAvatarUrl(thumbPath) });
    vi.mocked(updatePlayer).mockRejectedValue(new Error('db down'));
    fake.api.remove.mockClear();

    const res = await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));

    expect(res.status).toBe(500);
    expect(fake.api.remove).not.toHaveBeenCalled();
    expect(fake.objects.has(originalPath)).toBe(true);
    expect(fake.objects.has(thumbPath)).toBe(true);
  });

  it('keeps the uploaded objects when the failed update committed after all', async () => {
    let committedUrl: string | null = null;
    vi.mocked(updatePlayer).mockImplementation(async (_id, input) => {
      committedUrl = input.avatar_url ?? null;
      throw new Error('connection reset after commit');
    });
    vi.mocked(getPlayerById).mockImplementation(async () => ({ ...MOCK_PLAYER, avatar_url: committedUrl }));

    const res = await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));

    const [originalPath] = uploadCall(0);
    expect(res.status).toBe(500);
    expect(committedUrl).toBe(publicAvatarUrl(`${originalPath}.thumb.webp`));
    // avatar_url names the new thumbnail, so deleting it would break the avatar.
    expect(fake.api.remove).not.toHaveBeenCalled();
    expect(fake.objects.has(`${originalPath}.thumb.webp`)).toBe(true);
  });

  it('keeps the uploaded objects (and logs) when the row cannot be re-read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(updatePlayer).mockRejectedValue(new Error('db down'));
    let reads = 0;
    vi.mocked(getPlayerById).mockImplementation(async () => {
      reads += 1;
      if (reads > 1) throw new Error('db still down');
      return { ...MOCK_PLAYER };
    });

    const res = await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));

    const [originalPath] = uploadCall(0);
    expect(res.status).toBe(500);
    expect(fake.api.remove).not.toHaveBeenCalled();
    expect(fake.objects.has(originalPath)).toBe(true);
    expect(consoleError).toHaveBeenCalledWith('[API] Unsaved avatar upload cleanup threw:', expect.anything());
  });

  it('treats an existing thumbnail (same image uploaded again) as success', async () => {
    await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));
    const res = await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));

    expect((await res.json()).success).toBe(true);
    expect(updatePlayer).toHaveBeenCalledTimes(2);
  });

  it('removes legacy and previous versioned avatar files after saving, keeping the new ones', async () => {
    const previousOriginal = `${PLAYER_ID}.aaaaaaaaaaaaaaaa.png`;
    vi.mocked(getPlayerById).mockResolvedValue({
      ...MOCK_PLAYER,
      avatar_url: publicAvatarUrl(`${previousOriginal}.thumb.webp`),
    });

    await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));

    const [newOriginal] = uploadCall(0);
    const removed = fake.api.remove.mock.calls[0][0];
    expect(removed).toEqual(expect.arrayContaining([
      ...legacyPlayerAvatarPaths(PLAYER_ID),
      previousOriginal,
      `${previousOriginal}.thumb.webp`,
    ]));
    expect(removed).not.toContain(newOriginal);
    expect(removed).not.toContain(`${newOriginal}.thumb.webp`);
    // Cleanup runs only after avatar_url points at the new thumbnail.
    expect(vi.mocked(updatePlayer).mock.invocationCallOrder[0])
      .toBeLessThan(fake.api.remove.mock.invocationCallOrder[0]);
  });

  it('never removes gallery objects when replacing a gallery avatar', async () => {
    vi.mocked(getPlayerById).mockResolvedValue({
      ...MOCK_PLAYER,
      avatar_url: publicAvatarUrl(`${GALLERY_ORIGINAL_PATH}.thumb.webp`),
    });

    await POST(makeRequest({ image: toDataUrl('image/png', realPng), config: {} }), makeRouteParams(PLAYER_ID));

    const removed = fake.api.remove.mock.calls[0][0] as string[];
    expect(removed.some((path) => path.startsWith('gallery/'))).toBe(false);
  });
});

// ── DELETE tests ───────────────────────────────────────────────────────

describe('DELETE /api/players/[id]/avatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake = createFakeAvatarBucket();
    storage.bucket = fake.api;
    vi.mocked(requireAuth).mockResolvedValue(OWN_SESSION as never);
    vi.mocked(getPlayerById).mockResolvedValue({ ...MOCK_PLAYER });
    vi.mocked(updatePlayer).mockResolvedValue({ ...MOCK_PLAYER, avatar_url: null });
  });

  it('clears player fields, then deletes the legacy avatar files', async () => {
    const req = {} as NextRequest;
    const res = await DELETE(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(updatePlayer).toHaveBeenCalledWith(PLAYER_ID, {
      avatar_url: null,
      avatar_config: null,
    });
    expect(fake.api.remove).toHaveBeenCalledWith(legacyPlayerAvatarPaths(PLAYER_ID));
    expect(vi.mocked(updatePlayer).mock.invocationCallOrder[0])
      .toBeLessThan(fake.api.remove.mock.invocationCallOrder[0]);
    expect(revalidateTag).toHaveBeenCalledWith('players', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(`player:${PLAYER_ID}`, { expire: 0 });
  });

  it('also deletes the current versioned original and thumbnail', async () => {
    vi.mocked(getPlayerById).mockResolvedValue({
      ...MOCK_PLAYER,
      avatar_url: publicAvatarUrl(`${PLAYER_ID}.bbbbbbbbbbbbbbbb.jpg.thumb.webp`),
    });

    await DELETE({} as NextRequest, makeRouteParams(PLAYER_ID));

    expect(fake.api.remove).toHaveBeenCalledWith([
      ...legacyPlayerAvatarPaths(PLAYER_ID),
      `${PLAYER_ID}.bbbbbbbbbbbbbbbb.jpg`,
      `${PLAYER_ID}.bbbbbbbbbbbbbbbb.jpg.thumb.webp`,
    ]);
  });

  it('leaves gallery images alone', async () => {
    vi.mocked(getPlayerById).mockResolvedValue({
      ...MOCK_PLAYER,
      avatar_url: publicAvatarUrl(`${GALLERY_ORIGINAL_PATH}.thumb.webp`),
    });

    await DELETE({} as NextRequest, makeRouteParams(PLAYER_ID));

    expect(fake.api.remove).toHaveBeenCalledWith(legacyPlayerAvatarPaths(PLAYER_ID));
  });

  it('still succeeds (and logs) when the storage cleanup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.api.remove.mockResolvedValueOnce({ data: [], error: { message: 'boom' } } as never);

    const res = await DELETE({} as NextRequest, makeRouteParams(PLAYER_ID));

    expect((await res.json()).success).toBe(true);
    expect(consoleError).toHaveBeenCalledWith('[API] Old avatar files could not be removed:', 'boom');
  });

  it('returns 403 when deleting another player avatar as non-admin', async () => {
    vi.mocked(requireAuth).mockResolvedValue(OTHER_SESSION as never);

    const req = {} as NextRequest;
    const res = await DELETE(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Not authorized to edit this avatar');
    expect(json.code).toBe('avatar_edit_forbidden');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('allows admin to delete any avatar', async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN_SESSION as never);

    const req = {} as NextRequest;
    const res = await DELETE(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(json.success).toBe(true);
  });

  it('returns 404 when player does not exist', async () => {
    vi.mocked(getPlayerById).mockResolvedValue(null);

    const req = {} as NextRequest;
    const res = await DELETE(req, makeRouteParams(PLAYER_ID));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Player not found');
    expect(json.code).toBe('player_not_found');
  });
});
