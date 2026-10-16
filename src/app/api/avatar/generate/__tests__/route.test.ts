import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import sharp from 'sharp';
import {
  createFakeAvatarBucket,
  makeTestPng,
  toDataUrl,
} from '@/lib/avatar/__tests__/avatar-test-helpers';

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

vi.mock('@/lib/avatar/nanogpt', () => ({
  generateImage: vi.fn(),
}));

vi.mock('@/lib/avatar/prompt-template', () => ({
  composePrompt: vi.fn().mockReturnValue('A trainer with red hair'),
  validateChoices: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/avatar/rate-limit', () => ({
  checkAndRecordGeneration: vi.fn(),
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

vi.mock('@/lib/supabase/queries/avatar-gallery', () => ({
  insertGalleryItem: vi.fn().mockResolvedValue({ id: 'gal-1' }),
}));

import { POST } from '@/app/api/avatar/generate/route';
import { requireAuth } from '@/lib/auth/helpers';
import { generateImage } from '@/lib/avatar/nanogpt';
import { validateChoices } from '@/lib/avatar/prompt-template';
import { checkAndRecordGeneration } from '@/lib/avatar/rate-limit';
import { insertGalleryItem } from '@/lib/supabase/queries/avatar-gallery';

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

const validChoices = {
  art_style: 'anime',
  hair_color: 'red',
  skin_tone: 'medium',
};

function makeRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

let fake: ReturnType<typeof createFakeAvatarBucket>;
let realPng: Buffer;

beforeAll(async () => {
  realPng = await makeTestPng(1024, 1024);
});

describe('POST /api/avatar/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake = createFakeAvatarBucket();
    fake.api.getPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://cdn.example.com/avatars/gallery/p1/gen.png' },
    });
    storage.bucket = fake.api;
    vi.mocked(requireAuth).mockResolvedValue(SESSION_WITH_PLAYER as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Auth / registration ───────────────────────────────────

  it('returns 403 when player is not registered', async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION_NO_PLAYER);

    const res = await POST(makeRequest({ choices: validChoices }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Player registration required');
    expect(body.code).toBe('player_registration_required');
  });

  // ── Validation ────────────────────────────────────────────

  it('rejects when choices field is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('choices');
    expect(body.code).toBe('validation_failed');
  });

  it('rejects when choices validation fails', async () => {
    vi.mocked(validateChoices).mockReturnValue(['art_style is required', 'hair_color invalid']);

    const res = await POST(makeRequest({ choices: { bad: 'value' } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid choices');
    expect(body.code).toBe('avatar_choices_invalid');
  });

  // ── Rate limiting ─────────────────────────────────────────

  it('returns 429 when rate limit exceeded', async () => {
    vi.mocked(validateChoices).mockReturnValue([]);
    vi.mocked(checkAndRecordGeneration).mockResolvedValue({
      allowed: false,
      remaining: 0,
      used: 10,
      limit: 10,
    });

    const res = await POST(makeRequest({ choices: validChoices }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('limit reached');
    expect(body).toMatchObject({ code: 'daily_limit_reached', params: { limit: 10 } });
  });

  // ── Happy path ────────────────────────────────────────────

  it('generates an avatar and returns result with gallery info', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // 'genresult' is not a decodable image
    vi.mocked(validateChoices).mockReturnValue([]);
    vi.mocked(checkAndRecordGeneration).mockResolvedValue({
      allowed: true,
      remaining: 7,
      used: 3,
      limit: 10,
    });
    vi.mocked(generateImage).mockResolvedValue('data:image/png;base64,genresult');

    const res = await POST(makeRequest({ choices: validChoices }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.image).toBe('data:image/png;base64,genresult');
    expect(body.data.remaining).toBe(6); // 7 - 1
    expect(body.data.gallery_id).toBe('gal-1');
    expect(body.data.gallery_url).toBe('https://cdn.example.com/avatars/gallery/p1/gen.png');

    expect(vi.mocked(insertGalleryItem)).toHaveBeenCalledWith(
      expect.objectContaining({
        player_id: 'p1',
        style: 'anime',
      }),
    );
  });

  // ── Storage: cache + thumbnail ────────────────────────────

  it('uploads the gallery original to its UUID path with a 1-year cache', async () => {
    vi.mocked(validateChoices).mockReturnValue([]);
    vi.mocked(checkAndRecordGeneration).mockResolvedValue({ allowed: true, remaining: 7, used: 3, limit: 10 });
    vi.mocked(generateImage).mockResolvedValue(toDataUrl('image/png', realPng));

    await POST(makeRequest({ choices: validChoices }));

    const [path, body, options] = fake.api.upload.mock.calls[0] as unknown as [string, Buffer, Record<string, unknown>];
    expect(path).toMatch(/^gallery\/p1\/[0-9a-f-]{36}\.png$/);
    expect(body.equals(realPng)).toBe(true);
    expect(options).toEqual({ contentType: 'image/png', upsert: false, cacheControl: '31536000' });
  });

  it('writes a 256 px WebP thumbnail next to the generated original', async () => {
    vi.mocked(validateChoices).mockReturnValue([]);
    vi.mocked(checkAndRecordGeneration).mockResolvedValue({ allowed: true, remaining: 7, used: 3, limit: 10 });
    vi.mocked(generateImage).mockResolvedValue(toDataUrl('image/png', realPng));

    await POST(makeRequest({ choices: validChoices }));

    const [originalPath] = fake.api.upload.mock.calls[0] as unknown as [string];
    const [thumbPath, thumb, options] = fake.api.upload.mock.calls[1] as unknown as [string, Buffer, Record<string, unknown>];
    expect(thumbPath).toBe(`${originalPath}.thumb.webp`);
    expect(options).toEqual({ contentType: 'image/webp', cacheControl: '31536000', upsert: false });
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(256);
    expect(thumb.length).toBeLessThanOrEqual(30 * 1024);
  });

  it('still saves the gallery item when the thumbnail fails (logged)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(validateChoices).mockReturnValue([]);
    vi.mocked(checkAndRecordGeneration).mockResolvedValue({ allowed: true, remaining: 7, used: 3, limit: 10 });
    vi.mocked(generateImage).mockResolvedValue(toDataUrl('image/png', realPng));
    fake.api.upload
      .mockResolvedValueOnce({ data: { path: 'x' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Storage full', statusCode: '500', status: 500 } });

    const res = await POST(makeRequest({ choices: validChoices }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.gallery_id).toBe('gal-1');
    expect(vi.mocked(insertGalleryItem)).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[avatar/generate] Avatar thumbnail failed at upload'),
      expect.anything(),
    );
  });

  // ── Error path ────────────────────────────────────────────

  it('returns safeErrorResponse on unexpected error', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('session error'));

    const res = await POST(makeRequest({ choices: validChoices }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Image generation failed');
    expect(body.code).toBe('avatar_generation_failed');
  });
});
