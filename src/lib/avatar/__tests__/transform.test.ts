import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Set env before module loads ───────────────────────────────────

vi.hoisted(() => {
  process.env.AZURE_ENDPOINT_URL = 'https://azure.example.com';
  process.env.AZURE_ENDPOINT_KEY = 'test-azure-key';
  process.env.REPLICATE_API_TOKEN = 'test-replicate-token';
  process.env.AVATAR_MODERATION_REQUIRED = 'true';
});

// ─── Mocks ─────────────────────────────────────────────────────────

const mockRun = vi.fn();
vi.mock('replicate', () => {
  // Must use function() (not arrow) so it works with `new Replicate()`
  const MockReplicate = vi.fn(function (this: Record<string, unknown>) {
    this.run = mockRun;
  });
  return { default: MockReplicate };
});

const mockFetch = vi.fn();

// ─── Import after mocks ────────────────────────────────────────────

import {
  validateUpload,
  moderateImage,
  transformToTrainer,
  isModerationRequired,
} from '../transform';

// ─── Fixtures ──────────────────────────────────────────────────────

// JPEG magic bytes: FF D8 FF
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x00]);
// PNG magic bytes: 89 50 4E 47
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
// WebP magic bytes: RIFF
const WEBP_HEADER = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

function makeJpegBase64(): string {
  return JPEG_HEADER.toString('base64');
}

function makeJpegDataUrl(): string {
  return `data:image/jpeg;base64,${makeJpegBase64()}`;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('isModerationRequired', () => {
  it('returns a boolean', () => {
    expect(typeof isModerationRequired()).toBe('boolean');
  });
});

describe('validateUpload', () => {
  it('validates JPEG with data URL prefix', () => {
    const result = validateUpload(makeJpegDataUrl());
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it('validates JPEG without data URL prefix', () => {
    const result = validateUpload(makeJpegBase64());
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('validates PNG', () => {
    const b64 = PNG_HEADER.toString('base64');
    const result = validateUpload(`data:image/png;base64,${b64}`);
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe('image/png');
  });

  it('validates WebP', () => {
    const b64 = WEBP_HEADER.toString('base64');
    const result = validateUpload(`data:image/webp;base64,${b64}`);
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe('image/webp');
  });

  it('rejects oversized files', () => {
    const bigBuffer = Buffer.alloc(3 * 1024 * 1024);
    bigBuffer[0] = 0xff;
    bigBuffer[1] = 0xd8;
    bigBuffer[2] = 0xff;
    const b64 = bigBuffer.toString('base64');
    const result = validateUpload(b64);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too large');
    expect(result.code).toBe('avatar_file_too_large');
    expect(result.params).toEqual({ max: 2 });
  });

  it('rejects files too small', () => {
    const tinyBuffer = Buffer.from([0xff, 0xd8]);
    const result = validateUpload(tinyBuffer.toString('base64'));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too small');
    expect(result.code).toBe('avatar_image_too_small');
  });

  it('rejects unsupported formats', () => {
    const gifHeader = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const result = validateUpload(gifHeader.toString('base64'));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported image format');
    expect(result.code).toBe('avatar_image_format_unsupported');
  });

  it('rejects MIME mismatch', () => {
    const b64 = PNG_HEADER.toString('base64');
    const result = validateUpload(`data:image/jpeg;base64,${b64}`);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('mismatch');
    expect(result.code).toBe('avatar_image_format_mismatch');
  });
});

describe('moderateImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
  });

  it('returns safe when all categories below threshold', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        categoriesAnalysis: [
          { category: 'Hate', severity: 0 },
          { category: 'Violence', severity: 2 },
        ],
      }),
    });

    const result = await moderateImage(JPEG_HEADER);
    expect(result.safe).toBe(true);
  });

  it('returns rejected when category exceeds threshold', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        categoriesAnalysis: [
          { category: 'Hate', severity: 0 },
          { category: 'Violence', severity: 5 },
        ],
      }),
    });

    const result = await moderateImage(JPEG_HEADER);
    expect(result.safe).toBe(false);
    expect(result.rejectedCategory).toBe('Violence');
  });

  it('returns unavailable on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await moderateImage(JPEG_HEADER);
    expect(result.safe).toBe(false);
    expect(result.unavailable).toBe(true);
  });

  it('returns unavailable on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Server error'),
    });

    const result = await moderateImage(JPEG_HEADER);
    expect(result.safe).toBe(false);
    expect(result.unavailable).toBe(true);
  });

  it('returns unavailable on JSON parse error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new Error('Parse error')),
    });

    const result = await moderateImage(JPEG_HEADER);
    expect(result.safe).toBe(false);
    expect(result.unavailable).toBe(true);
  });
});

describe('transformToTrainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
  });

  it('returns data URL directly when Replicate returns one', async () => {
    mockRun.mockResolvedValueOnce('data:image/png;base64,abc123');

    const result = await transformToTrainer(JPEG_HEADER);
    expect(result.image).toBe('data:image/png;base64,abc123');
  });

  it('handles array output from Replicate', async () => {
    mockRun.mockResolvedValueOnce(['data:image/png;base64,arrayresult']);

    const result = await transformToTrainer(JPEG_HEADER);
    expect(result.image).toBe('data:image/png;base64,arrayresult');
  });

  it('fetches and converts URL output', async () => {
    mockRun.mockResolvedValueOnce(['https://replicate.delivery/result.png']);

    const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (key: string) => {
          if (key === 'content-type') return 'image/png';
          if (key === 'content-length') return '4';
          return null;
        },
      },
      arrayBuffer: () => Promise.resolve(imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength)),
    });

    const result = await transformToTrainer(JPEG_HEADER);
    expect(result.image).toContain('data:image/png;base64,');
  });

  it('rejects non-HTTPS URLs', async () => {
    mockRun.mockResolvedValueOnce(['http://insecure.com/image.png']);

    await expect(transformToTrainer(JPEG_HEADER)).rejects.toThrow('must use HTTPS');
  });

  it('rejects disallowed hosts', async () => {
    mockRun.mockResolvedValueOnce(['https://evil.example.com/image.png']);

    await expect(transformToTrainer(JPEG_HEADER)).rejects.toThrow('host is not allowed');
  });

  it('rejects non-image content type', async () => {
    mockRun.mockResolvedValueOnce(['https://replicate.delivery/result.txt']);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (key: string) => {
          if (key === 'content-type') return 'text/plain';
          return null;
        },
      },
    });

    await expect(transformToTrainer(JPEG_HEADER)).rejects.toThrow('not an image');
  });

  it('rejects oversized images from Replicate (content-length)', async () => {
    mockRun.mockResolvedValueOnce(['https://replicate.delivery/big.png']);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (key: string) => {
          if (key === 'content-type') return 'image/png';
          if (key === 'content-length') return '10000000';
          return null;
        },
      },
    });

    await expect(transformToTrainer(JPEG_HEADER)).rejects.toThrow('exceeds size limit');
  });

  it('throws on unexpected Replicate output format', async () => {
    mockRun.mockResolvedValueOnce(12345);

    await expect(transformToTrainer(JPEG_HEADER)).rejects.toThrow('Unexpected Replicate output');
  });

  it('throws when download fails', async () => {
    mockRun.mockResolvedValueOnce(['https://replicate.delivery/fail.png']);

    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(transformToTrainer(JPEG_HEADER)).rejects.toThrow('Failed to download');
  });
});
