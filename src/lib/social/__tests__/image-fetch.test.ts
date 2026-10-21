import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allowedSocialImageUrl,
  fetchImageAsBuffer,
  SOCIAL_IMAGE_FETCH_BUCKET,
  SOCIAL_IMAGE_FETCH_MAX_BYTES,
  SOCIAL_IMAGE_FETCH_TIMEOUT_MS,
} from '../image-fetch';
import { SOCIAL_IMAGE_BUCKET, SOCIAL_IMAGE_MAX_BYTES } from '@/app/api/matches/[id]/social-image/storage-path';

const ORIGIN = 'https://abcdefghijklmnop.supabase.co';
const MATCH_ID = '12345678-1234-4123-8123-123456789abc';
const OBJECT_ID = '87654321-4321-4321-8321-cba987654321';
const CARD_URL = `${ORIGIN}/storage/v1/object/public/social-images/matches/${MATCH_ID}/${OBJECT_ID}.png`;
const PNG = new Uint8Array([137, 80, 78, 71]);

const mockFetch = vi.fn();

function imageResponse(body: BodyInit | null, headers: Record<string, string> = { 'content-type': 'image/png' }) {
  return new Response(body, { status: 200, headers });
}

/** A body stream that yields `chunks` of `size` bytes, counting how many were pulled. */
function chunkedStream(chunks: number, size: number) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) {
        controller.close();
        return;
      }
      pulled += 1;
      controller.enqueue(new Uint8Array(size));
    },
  });
  return { stream, pulled: () => pulled };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ORIGIN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('allowedSocialImageUrl', () => {
  it('accepts a public social-images object on the project origin', () => {
    expect(allowedSocialImageUrl(CARD_URL, ORIGIN)).toBe(CARD_URL);
  });

  it('accepts the legacy fixed card name', () => {
    const legacy = `${ORIGIN}/storage/v1/object/public/social-images/matches/${MATCH_ID}.png`;
    expect(allowedSocialImageUrl(legacy, ORIGIN)).toBe(legacy);
  });

  it('accepts the http origin of the local Supabase stack', () => {
    const local = 'http://127.0.0.1:54321';
    const url = `${local}/storage/v1/object/public/social-images/matches/${MATCH_ID}.png`;
    expect(allowedSocialImageUrl(url, local)).toBe(url);
  });

  it.each([
    ['another host', `https://evil.example.com/storage/v1/object/public/social-images/x.png`],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['another scheme on the same host', CARD_URL.replace('https://', 'http://')],
    ['another port', CARD_URL.replace('.supabase.co/', '.supabase.co:8443/')],
    ['userinfo', CARD_URL.replace('https://', 'https://user:pass@')],
    ['another bucket', `${ORIGIN}/storage/v1/object/public/avatars/a.png`],
    ['a signed (non-public) object', `${ORIGIN}/storage/v1/object/sign/social-images/a.png`],
    ['a REST path', `${ORIGIN}/rest/v1/players?select=*`],
    ['an encoded traversal', `${ORIGIN}/storage/v1/object/public/social-images/%2e%2e/avatars/a.png`],
    ['an encoded slash traversal', `${ORIGIN}/storage/v1/object/public/social-images/..%2Favatars%2Fa.png`],
    ['the bucket root', `${ORIGIN}/storage/v1/object/public/social-images/`],
    ['a malformed encoding', `${ORIGIN}/storage/v1/object/public/social-images/%E0%A4%A.png`],
    ['not a URL', 'not a url'],
  ])('rejects %s', (_label, url) => {
    expect(allowedSocialImageUrl(url, ORIGIN)).toBeNull();
  });

  it('rejects a literal traversal that the URL parser resolves out of the bucket', () => {
    const url = `${ORIGIN}/storage/v1/object/public/social-images/../avatars/a.png`;
    expect(allowedSocialImageUrl(url, ORIGIN)).toBeNull();
  });

  it('fails closed when the project origin is unknown', () => {
    expect(allowedSocialImageUrl(CARD_URL, null)).toBeNull();
  });

  it('reads the origin from NEXT_PUBLIC_SUPABASE_URL by default', () => {
    expect(allowedSocialImageUrl(CARD_URL)).toBe(CARD_URL);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://other.supabase.co');
    expect(allowedSocialImageUrl(CARD_URL)).toBeNull();
  });

  it('names the same bucket the upload route writes', () => {
    expect(SOCIAL_IMAGE_FETCH_BUCKET).toBe(SOCIAL_IMAGE_BUCKET);
  });

  it('caps the body at the same size the upload route accepts', () => {
    expect(SOCIAL_IMAGE_FETCH_MAX_BYTES).toBe(SOCIAL_IMAGE_MAX_BYTES);
  });
});

describe('fetchImageAsBuffer', () => {
  it('returns the body and content type of an allowed card', async () => {
    mockFetch.mockResolvedValueOnce(imageResponse(PNG));

    const result = await fetchImageAsBuffer(CARD_URL);

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect([...result.buffer]).toEqual([...PNG]);
    expect(result.contentType).toBe('image/png');
  });

  it('fetches with a deadline and refuses redirects', async () => {
    mockFetch.mockResolvedValueOnce(imageResponse(PNG));

    await fetchImageAsBuffer(CARD_URL);

    expect(mockFetch).toHaveBeenCalledWith(CARD_URL, {
      signal: expect.any(AbortSignal),
      redirect: 'error',
    });
  });

  it.each([
    'https://evil.example.com/a.png',
    'http://169.254.169.254/latest/meta-data/',
    `${ORIGIN}/storage/v1/object/public/avatars/a.png`,
  ])('throws without fetching for a URL outside the allowlist: %s', async (url) => {
    await expect(fetchImageAsBuffer(url)).rejects.toThrow(
      "Social image URL is not a public social-images object on the project's Supabase origin"
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws without fetching when NEXT_PUBLIC_SUPABASE_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    await expect(fetchImageAsBuffer(CARD_URL)).rejects.toThrow('is not a public social-images object');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('defaults the content type to image/png when the header is missing', async () => {
    mockFetch.mockResolvedValueOnce(new Response(PNG, { status: 200 }));
    // A Uint8Array body gets no implicit content-type.
    const result = await fetchImageAsBuffer(CARD_URL);
    expect(result.contentType).toBe('image/png');
  });

  it('preserves an image content type from the response', async () => {
    mockFetch.mockResolvedValueOnce(imageResponse(PNG, { 'content-type': 'image/webp' }));
    const result = await fetchImageAsBuffer(CARD_URL);
    expect(result.contentType).toBe('image/webp');
  });

  it('rejects a non-image content type', async () => {
    mockFetch.mockResolvedValueOnce(imageResponse('<html></html>', { 'content-type': 'text/html' }));
    await expect(fetchImageAsBuffer(CARD_URL)).rejects.toThrow(
      'Social image has a non-image content type: text/html'
    );
  });

  it('throws when the response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(fetchImageAsBuffer(CARD_URL)).rejects.toThrow('Failed to fetch social image: 404');
  });

  it('rejects a declared length above the cap before reading the body', async () => {
    const { stream, pulled } = chunkedStream(1, 16);
    mockFetch.mockResolvedValueOnce(
      imageResponse(stream, {
        'content-type': 'image/png',
        'content-length': String(SOCIAL_IMAGE_FETCH_MAX_BYTES + 1),
      })
    );

    await expect(fetchImageAsBuffer(CARD_URL)).rejects.toThrow(
      `Social image exceeds ${SOCIAL_IMAGE_FETCH_MAX_BYTES} bytes (${SOCIAL_IMAGE_FETCH_MAX_BYTES + 1} declared)`
    );
    expect(pulled()).toBeLessThanOrEqual(1);
  });

  it('stops reading an undeclared body once it passes the cap', async () => {
    const chunk = 1024 * 1024;
    const { stream, pulled } = chunkedStream(50, chunk);
    mockFetch.mockResolvedValueOnce(imageResponse(stream));

    await expect(fetchImageAsBuffer(CARD_URL)).rejects.toThrow(
      `Social image exceeds ${SOCIAL_IMAGE_FETCH_MAX_BYTES} bytes`
    );
    // 5 MB cap with 1 MB chunks: the sixth chunk trips it (plus at most one prefetched).
    expect(pulled()).toBeLessThanOrEqual(7);
  });

  it('accepts a body of exactly the cap', async () => {
    mockFetch.mockResolvedValueOnce(imageResponse(new Uint8Array(SOCIAL_IMAGE_FETCH_MAX_BYTES)));
    const result = await fetchImageAsBuffer(CARD_URL);
    expect(result.buffer.byteLength).toBe(SOCIAL_IMAGE_FETCH_MAX_BYTES);
  });

  it('ignores a non-numeric content-length and still caps the body', async () => {
    mockFetch.mockResolvedValueOnce(imageResponse(PNG, { 'content-type': 'image/png', 'content-length': 'abc' }));
    const result = await fetchImageAsBuffer(CARD_URL);
    expect(result.buffer.byteLength).toBe(PNG.byteLength);
  });

  it('maps the deadline to a timeout error that keeps the cause', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    mockFetch.mockRejectedValueOnce(timeout);

    const err = await fetchImageAsBuffer(CARD_URL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(`Social image fetch timed out after ${SOCIAL_IMAGE_FETCH_TIMEOUT_MS} ms`);
    expect((err as Error).cause).toBe(timeout);
  });

  it('aborts a stalled response when the deadline signal fires', async () => {
    const deadline = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    mockFetch.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        })
    );

    try {
      const pending = fetchImageAsBuffer(CARD_URL).catch((e: unknown) => e);
      expect(timeoutSpy).toHaveBeenCalledWith(SOCIAL_IMAGE_FETCH_TIMEOUT_MS);
      deadline.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      const err = await pending;
      expect((err as Error).message).toBe(`Social image fetch timed out after ${SOCIAL_IMAGE_FETCH_TIMEOUT_MS} ms`);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('propagates network errors unchanged', async () => {
    const network = new TypeError('fetch failed');
    mockFetch.mockRejectedValueOnce(network);
    await expect(fetchImageAsBuffer(CARD_URL)).rejects.toBe(network);
  });

  it('propagates a refused redirect unchanged', async () => {
    const redirect = new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    mockFetch.mockRejectedValueOnce(redirect);
    await expect(fetchImageAsBuffer(CARD_URL)).rejects.toBe(redirect);
  });
});
