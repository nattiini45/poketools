import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { requireAdmin: vi.fn(), AuthError };
});

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn().mockImplementation((_err: unknown, msg: string) =>
    NextResponse.json({ success: false, error: msg }, { status: 500 }),
  ),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  updateMatchSocialImageUrl: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn(),
        getPublicUrl: vi.fn(),
        remove: vi.fn(),
      }),
    },
  },
}));

import { POST, DELETE } from '../route';
import { requireAdmin } from '@/lib/auth/helpers';
import { getMatchById, updateMatchSocialImageUrl } from '@/lib/supabase/queries/matches';
import { supabase } from '@/lib/supabase/client';
import { safeErrorResponse } from '@/lib/api/error-response';
import { SupabaseTimeoutError } from '@/lib/supabase/timeout-fetch';

const mockRequireAdmin = requireAdmin as ReturnType<typeof vi.fn>;
const mockGetMatch = getMatchById as ReturnType<typeof vi.fn>;
const mockUpdateUrl = updateMatchSocialImageUrl as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_MATCH_ID = '44444444-4444-4444-8444-444444444444';
/** `NEXT_PUBLIC_SUPABASE_URL` as vitest.config.ts sets it. */
const ORIGIN = 'https://example.supabase.co';
const PUBLIC_PREFIX = `${ORIGIN}/storage/v1/object/public/social-images/`;
const IMMUTABLE_PATH_RE = new RegExp(
  `^matches/${MATCH_ID}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]png$`,
);

function bucket() {
  return supabase.storage.from('social-images') as unknown as {
    upload: ReturnType<typeof vi.fn>;
    getPublicUrl: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
}

function servePublicUrls() {
  bucket().getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `${PUBLIC_PREFIX}${path}` } }));
}

function makeArgs(
  id: string,
  body?: Record<string, unknown>,
  method = 'POST',
): [NextRequest, { params: Promise<{ id: string }> }] {
  const url = new URL(`http://localhost:3000/api/matches/${id}/social-image`);
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  const req = new Request(url.toString(), init) as unknown as NextRequest;
  return [req, { params: Promise.resolve({ id }) }];
}

// A tiny valid base64 PNG (1x1 pixel)
const TINY_PNG_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('POST /api/matches/[id]/social-image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue({ playerId: 'admin-1', isAdmin: true });
  });

  it('uploads social image successfully', async () => {
    mockGetMatch.mockResolvedValue({ id: MATCH_ID, status: 'completed', social_image_url: null });
    bucket().upload.mockResolvedValue({ error: null });
    servePublicUrls();
    mockUpdateUrl.mockResolvedValue(undefined);

    const [req, ctx] = makeArgs(MATCH_ID, { image: TINY_PNG_B64 });
    const res = await POST(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    const [path] = bucket().upload.mock.calls[0];
    expect(json.data.url).toBe(`${PUBLIC_PREFIX}${path}`);
    expect(mockUpdateUrl).toHaveBeenCalledWith(MATCH_ID, `${PUBLIC_PREFIX}${path}`);
  });

  it('writes a new immutable object per upload: UUID name, one-year cache, never upsert', async () => {
    mockGetMatch.mockResolvedValue({ id: MATCH_ID, status: 'completed', social_image_url: null });
    bucket().upload.mockResolvedValue({ error: null });
    servePublicUrls();

    const first = await (await POST(...makeArgs(MATCH_ID, { image: TINY_PNG_B64 }))).json();
    const second = await (await POST(...makeArgs(MATCH_ID, { image: TINY_PNG_B64 }))).json();

    const [[path1, , options1], [path2, , options2]] = bucket().upload.mock.calls;
    expect(path1).toMatch(IMMUTABLE_PATH_RE);
    expect(path2).toMatch(IMMUTABLE_PATH_RE);
    // Before: every upload overwrote `matches/<id>.png` (upsert, the default
    // one-hour cache), so the stored URL never changed and caches kept
    // serving the old card.
    expect(path1).not.toBe(path2);
    expect(first.data.url).not.toBe(second.data.url);
    for (const options of [options1, options2]) {
      expect(options).toEqual({ contentType: 'image/png', cacheControl: '31536000', upsert: false });
    }
  });

  it('keeps the object a re-upload replaces (a posted embed keeps its image)', async () => {
    mockGetMatch.mockResolvedValue({
      id: MATCH_ID,
      status: 'completed',
      social_image_url: `${PUBLIC_PREFIX}matches/${MATCH_ID}.png`,
    });
    bucket().upload.mockResolvedValue({ error: null });
    servePublicUrls();

    const res = await POST(...makeArgs(MATCH_ID, { image: TINY_PNG_B64 }));

    expect(res.status).toBe(201);
    expect(bucket().remove).not.toHaveBeenCalled();
  });

  it('returns 404 INVALID_MATCH_ID for a malformed id without querying', async () => {
    const res = await POST(...makeArgs('m-1', { image: TINY_PNG_B64 }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.code).toBe('INVALID_MATCH_ID');
    expect(mockGetMatch).not.toHaveBeenCalled();
  });

  it('returns 404 when match not found', async () => {
    mockGetMatch.mockResolvedValue(null);

    const [req, ctx] = makeArgs(OTHER_MATCH_ID, { image: TINY_PNG_B64 });
    const res = await POST(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Match not found');
    expect(json.code).toBe('match_not_found');
  });

  it('returns 400 when image field is missing', async () => {
    mockGetMatch.mockResolvedValue({ id: MATCH_ID });

    const [req, ctx] = makeArgs(MATCH_ID, {});
    const res = await POST(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('image');
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: json.error });
  });

  it.each([
    ['too-short data', 'data:image/png;base64,AA==', 'Invalid image data', 'match_social_image_invalid'],
    ['a non-PNG image', `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]).toString('base64')}`, 'Only PNG images are accepted', 'match_social_image_not_png'],
  ])('rejects %s with its own code', async (_label, image, error, code) => {
    mockGetMatch.mockResolvedValue({ id: MATCH_ID });

    const [req, ctx] = makeArgs(MATCH_ID, { image });
    const res = await POST(req, ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error, code });
    expect(bucket().upload).not.toHaveBeenCalled();
  });

  it('returns 500 when upload fails, and stores no URL', async () => {
    mockGetMatch.mockResolvedValue({ id: MATCH_ID });
    bucket().upload.mockResolvedValue({ error: { message: 'storage full' } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const [req, ctx] = makeArgs(MATCH_ID, { image: TINY_PNG_B64 });
      const res = await POST(req, ctx);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.success).toBe(false);
      expect(json.error).toContain('Failed to upload');
      expect(json.code).toBe('match_social_image_upload_failed');
      expect(mockUpdateUrl).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a Storage request deadline on upload goes to safeErrorResponse, which maps it to 504 upstream_timeout (not the 500 branch)', async () => {
    mockGetMatch.mockResolvedValue({ id: MATCH_ID });
    // storage-js wraps a thrown fetch as StorageUnknownError with the original under `originalError`.
    const timeout = new SupabaseTimeoutError('storage', 'POST', '/storage/v1/object/social-images/x.png', 30_000, null);
    const storageError = { name: 'StorageUnknownError', message: timeout.message, originalError: timeout };
    bucket().upload.mockResolvedValue({ error: storageError });

    const [req, ctx] = makeArgs(MATCH_ID, { image: TINY_PNG_B64 });
    await POST(req, ctx);

    expect(safeErrorResponse).toHaveBeenCalledWith(storageError, 'Failed to upload social image');
    expect(mockUpdateUrl).not.toHaveBeenCalled();
    // The real helper (mocked above for routing) answers exactly that error with the catalogued 504.
    const real = await vi.importActual<typeof import('@/lib/api/error-response')>('@/lib/api/error-response');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mapped = real.safeErrorResponse(storageError, 'Failed to upload social image');
    expect(mapped.status).toBe(504);
    expect(await mapped.json()).toMatchObject({ success: false, code: 'upstream_timeout' });
  });
});

describe('DELETE /api/matches/[id]/social-image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue({ playerId: 'admin-1', isAdmin: true });
  });

  it('removes the object the stored URL names and clears the column', async () => {
    const path = `matches/${MATCH_ID}/0f0e0d0c-0b0a-4908-8706-050403020100.png`;
    mockGetMatch.mockResolvedValue({ id: MATCH_ID, social_image_url: `${PUBLIC_PREFIX}${path}` });
    bucket().remove.mockResolvedValue({ error: null });
    mockUpdateUrl.mockResolvedValue(undefined);

    const [req, ctx] = makeArgs(MATCH_ID, undefined, 'DELETE');
    const res = await DELETE(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
    expect(bucket().remove).toHaveBeenCalledWith([path]);
    expect(mockUpdateUrl).toHaveBeenCalledWith(MATCH_ID, null);
  });

  it('removes a legacy fixed-name object too', async () => {
    mockGetMatch.mockResolvedValue({ id: MATCH_ID, social_image_url: `${PUBLIC_PREFIX}matches/${MATCH_ID}.png` });
    bucket().remove.mockResolvedValue({ error: null });

    const res = await DELETE(...makeArgs(MATCH_ID, undefined, 'DELETE'));

    expect(res.status).toBe(200);
    expect(bucket().remove).toHaveBeenCalledWith([`matches/${MATCH_ID}.png`]);
  });

  it.each([
    ['another origin', `https://evil.example.com/storage/v1/object/public/social-images/matches/${MATCH_ID}.png`],
    ['another match', `${PUBLIC_PREFIX}matches/${OTHER_MATCH_ID}.png`],
    ['a path escape', `${PUBLIC_PREFIX}matches/${MATCH_ID}/..%2F..%2Favatars%2Fx.png`],
    ['another bucket', `${ORIGIN}/storage/v1/object/public/avatars/matches/${MATCH_ID}.png`],
  ])('never removes an object for a stored URL on %s; clears the column only', async (_label, url) => {
    mockGetMatch.mockResolvedValue({ id: MATCH_ID, social_image_url: url });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const res = await DELETE(...makeArgs(MATCH_ID, undefined, 'DELETE'));

      expect(res.status).toBe(200);
      expect(bucket().remove).not.toHaveBeenCalled();
      expect(mockUpdateUrl).toHaveBeenCalledWith(MATCH_ID, null);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('a failed removal keeps the URL and answers 500 STORAGE_REMOVE_FAILED', async () => {
    mockGetMatch.mockResolvedValue({ id: MATCH_ID, social_image_url: `${PUBLIC_PREFIX}matches/${MATCH_ID}.png` });
    bucket().remove.mockResolvedValue({ error: { message: 'storage down' } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const res = await DELETE(...makeArgs(MATCH_ID, undefined, 'DELETE'));
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.code).toBe('STORAGE_REMOVE_FAILED');
      expect(mockUpdateUrl).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a Storage request deadline on removal goes to safeErrorResponse and keeps the URL', async () => {
    mockGetMatch.mockResolvedValue({ id: MATCH_ID, social_image_url: `${PUBLIC_PREFIX}matches/${MATCH_ID}.png` });
    const timeout = new SupabaseTimeoutError('storage', 'DELETE', '/storage/v1/object/social-images', 30_000, null);
    bucket().remove.mockResolvedValue({ error: timeout });

    await DELETE(...makeArgs(MATCH_ID, undefined, 'DELETE'));

    expect(safeErrorResponse).toHaveBeenCalledWith(timeout, 'Failed to remove social image file');
    expect(mockUpdateUrl).not.toHaveBeenCalled();
  });

  it('returns 404 when match not found for delete', async () => {
    mockGetMatch.mockResolvedValue(null);

    const [req, ctx] = makeArgs(OTHER_MATCH_ID, undefined, 'DELETE');
    const res = await DELETE(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.code).toBe('match_not_found');
  });
});
