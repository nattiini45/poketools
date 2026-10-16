import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

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

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('clean-image')),
  }),
}));

vi.mock('@/lib/avatar/rate-limit', () => ({
  checkAndRecordGeneration: vi.fn(),
}));

vi.mock('@/lib/avatar/transform', () => ({
  validateUpload: vi.fn(),
  moderateImage: vi.fn(),
  transformToTrainer: vi.fn(),
  isModerationRequired: vi.fn(),
}));

vi.mock('@/lib/avatar/consent', () => ({
  PHOTO_TRANSFORM_CONSENT_VERSION: '1.0',
}));

const storageMocks = vi.hoisted(() => ({
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
}));

// sharp is mocked above, so the thumbnail writer is mocked too (it has its own tests).
vi.mock('@/lib/avatar/thumbnail', () => ({
  AVATAR_IMMUTABLE_CACHE_CONTROL: '31536000',
  tryWriteAvatarThumbnail: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    storage: {
      from: vi.fn().mockReturnValue({
        upload: storageMocks.upload,
        getPublicUrl: storageMocks.getPublicUrl,
      }),
    },
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'gallery-1' },
            error: undefined,
          }),
        }),
      }),
    }),
  },
}));

import { POST } from '@/app/api/avatar/transform/route';
import { tryWriteAvatarThumbnail } from '@/lib/avatar/thumbnail';
import { requireAuth } from '@/lib/auth/helpers';
import { checkAndRecordGeneration } from '@/lib/avatar/rate-limit';
import {
  validateUpload,
  moderateImage,
  transformToTrainer,
  isModerationRequired,
} from '@/lib/avatar/transform';

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

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('POST /api/avatar/transform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(SESSION_WITH_PLAYER as never);
    storageMocks.upload.mockResolvedValue({ error: undefined });
    storageMocks.getPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://cdn.example.com/avatars/gallery/p1/img.png' },
    });
    vi.mocked(tryWriteAvatarThumbnail).mockImplementation(async (_bucket, originalPath) => `${originalPath}.thumb.webp`);
  });

  // ── Auth / registration ───────────────────────────────────

  it('returns 403 when player is not registered', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_NO_PLAYER);

    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '1.0' }),
    );
    expect(res.status).toBe(403);    expect((await res.json()).code).toBe('player_registration_required');
  });

  // ── Validation ────────────────────────────────────────────

  it('rejects when image is missing', async () => {
    const res = await POST(makeRequest({ consentAccepted: true, consentVersion: '1.0' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('image');
    expect(body.code).toBe('validation_failed');
  });

  it('rejects when consent not accepted', async () => {
    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: false, consentVersion: '1.0' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('consent');
  });

  it('rejects when consent version is outdated', async () => {
    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '0.9' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Consent text has changed');
    expect(body.code).toBe('avatar_consent_outdated');
  });

  // ── Upload validation ─────────────────────────────────────

  it('rejects invalid upload (bad MIME/magic bytes)', async () => {
    vi.mocked(validateUpload).mockReturnValue({
      valid: false,
      error: 'Unsupported file type',
      buffer: undefined,
    });

    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '1.0' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Unsupported file type');
    expect(body.code).toBeUndefined(); // a message without a code: English only
  });

  it.each([
    ['Invalid base64 encoding', { code: 'avatar_image_invalid_base64' as const }],
    ['File too small to be a valid image', { code: 'avatar_image_too_small' as const }],
    ['Unsupported image format. Use JPEG, PNG, or WebP.', { code: 'avatar_image_format_unsupported' as const }],
    ['Image format mismatch', { code: 'avatar_image_format_mismatch' as const }],
    ['File too large (max 2MB)', { code: 'avatar_file_too_large' as const, params: { max: 2 } }],
  ])('passes the validateUpload code through for %j', async (message, expected) => {
    vi.mocked(validateUpload).mockReturnValue({ valid: false, error: message, ...expected, buffer: undefined });

    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '1.0' }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe(message);
    expect(body).toMatchObject(expected);
    if (!('params' in expected)) expect(body.params).toBeUndefined();
  });

  it('answers a validateUpload failure without a message as Invalid image', async () => {
    vi.mocked(validateUpload).mockReturnValue({ valid: false, error: undefined, buffer: undefined });

    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '1.0' }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid image', code: 'avatar_image_invalid' });
  });

  // ── Rate limiting ─────────────────────────────────────────

  it('returns 429 when rate limit exceeded', async () => {
    vi.mocked(validateUpload).mockReturnValue({
      valid: true,
      buffer: Buffer.from('img'),
      error: undefined,
    });
    vi.mocked(checkAndRecordGeneration).mockResolvedValue({
      allowed: false,
      remaining: 0,
      used: 10,
      limit: 10,
    });

    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '1.0' }),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('limit reached');
    expect(body).toMatchObject({ code: 'daily_limit_reached', params: { limit: 10 } });
  });

  // ── Moderation ────────────────────────────────────────────

  it('returns 422 when moderation flags content as unsafe', async () => {
    vi.mocked(validateUpload).mockReturnValue({ valid: true, buffer: Buffer.from('img'), error: undefined });
    vi.mocked(checkAndRecordGeneration).mockResolvedValue({ allowed: true, remaining: 5, used: 10, limit: 10 });
    vi.mocked(moderateImage).mockResolvedValue({ safe: false, unavailable: false });

    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '1.0' }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('avatar_image_rejected');
  });

  it('returns 503 when moderation is unavailable and required', async () => {
    vi.mocked(validateUpload).mockReturnValue({ valid: true, buffer: Buffer.from('img'), error: undefined });
    vi.mocked(checkAndRecordGeneration).mockResolvedValue({ allowed: true, remaining: 5, used: 10, limit: 10 });
    vi.mocked(moderateImage).mockResolvedValue({ safe: false, unavailable: true });
    vi.mocked(isModerationRequired).mockReturnValue(true);

    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '1.0' }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('avatar_moderation_unavailable');
  });

  // ── Happy path ────────────────────────────────────────────

  it('transforms image and returns result with gallery info', async () => {
    vi.mocked(validateUpload).mockReturnValue({ valid: true, buffer: Buffer.from('img'), error: undefined });
    vi.mocked(checkAndRecordGeneration).mockResolvedValue({ allowed: true, remaining: 5, used: 10, limit: 10 });
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, unavailable: false });
    vi.mocked(transformToTrainer).mockResolvedValue({
      image: 'data:image/png;base64,resultdata',
    });

    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '1.0' }),
    );
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.image).toBe('data:image/png;base64,resultdata');
    expect(body.data.remaining).toBe(4); // 5 - 1
    expect(body.data.gallery_id).toBe('gallery-1');
    expect(body.data.gallery_url).toBe('https://cdn.example.com/avatars/gallery/p1/img.png');
  });

  // ── Storage: cache + thumbnail ────────────────────────────

  it('uploads the result with a 1-year cache and writes its thumbnail next to it', async () => {
    vi.mocked(validateUpload).mockReturnValue({ valid: true, buffer: Buffer.from('img'), error: undefined });
    vi.mocked(checkAndRecordGeneration).mockResolvedValue({ allowed: true, remaining: 5, used: 10, limit: 10 });
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, unavailable: false });
    vi.mocked(transformToTrainer).mockResolvedValue({
      image: `data:image/png;base64,${Buffer.from('result-bytes').toString('base64')}`,
    });

    await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '1.0' }),
    );

    const [path, body, options] = storageMocks.upload.mock.calls[0] as [string, Buffer, Record<string, unknown>];
    expect(path).toMatch(/^gallery\/p1\/[0-9a-f-]{36}\.png$/);
    expect(body.toString()).toBe('result-bytes');
    expect(options).toEqual({ contentType: 'image/png', upsert: false, cacheControl: '31536000' });
    expect(tryWriteAvatarThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({ upload: storageMocks.upload }),
      path,
      body,
      'avatar/transform',
    );
  });

  it('does not write a thumbnail when the original upload failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(validateUpload).mockReturnValue({ valid: true, buffer: Buffer.from('img'), error: undefined });
    vi.mocked(checkAndRecordGeneration).mockResolvedValue({ allowed: true, remaining: 5, used: 10, limit: 10 });
    vi.mocked(moderateImage).mockResolvedValue({ safe: true, unavailable: false });
    vi.mocked(transformToTrainer).mockResolvedValue({ image: 'data:image/png;base64,resultdata' });
    storageMocks.upload.mockResolvedValue({ error: { message: 'Storage full' } });

    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '1.0' }),
    );

    expect((await res.json()).data.gallery_id).toBe('');
    expect(tryWriteAvatarThumbnail).not.toHaveBeenCalled();
  });

  // ── Error path ────────────────────────────────────────────

  it('returns safeErrorResponse on unexpected error', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('session expired'));

    const res = await POST(
      makeRequest({ image: 'data:image/png;base64,abc', consentAccepted: true, consentVersion: '1.0' }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Photo transform failed');
    expect(body.code).toBe('avatar_transform_failed');
  });
});
