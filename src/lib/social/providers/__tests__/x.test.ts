import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../image-fetch', () => ({
  fetchImageAsBuffer: vi.fn(),
}));

import { postToX } from '../x';
import { fetchImageAsBuffer } from '../../image-fetch';
import type { XCredentials } from '@/types/social';

const mockFetchImageAsBuffer = vi.mocked(fetchImageAsBuffer);

function makeCredentials(overrides?: Partial<XCredentials>): XCredentials {
  return {
    provider: 'x',
    access_token: 'x-bearer-token-123',
    ...overrides,
  };
}

function mockFetchResponses(responses: Array<{
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}>) {
  const calls = [...responses];
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
    const resp = calls.shift();
    if (!resp) throw new Error('Unexpected fetch call');
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status ?? (resp.ok ? 200 : 500),
      json: () => Promise.resolve(resp.json ?? {}),
      text: () => Promise.resolve(resp.text ?? ''),
    });
  }));
}

describe('postToX', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts a text-only tweet successfully', async () => {
    mockFetchResponses([
      { ok: true, json: { data: { id: 'tweet-1', text: 'Hello X!' } } },
    ]);

    await postToX(makeCredentials(), 'Hello X!');

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://api.x.com/2/tweets');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer x-bearer-token-123',
        'Content-Type': 'application/json',
      }),
    );

    const body = JSON.parse(call[1]?.body as string);
    expect(body.text).toBe('Hello X!');
    expect(body.media).toBeUndefined();
  });

  it('uploads media and attaches media_ids when imageUrl is provided', async () => {
    mockFetchImageAsBuffer.mockResolvedValue({
      buffer: Buffer.from('fake-image-data'),
      contentType: 'image/png',
    });

    mockFetchResponses([
      // media upload
      { ok: true, json: { media_id_string: 'media-123' } },
      // tweet
      { ok: true, json: { data: { id: 'tweet-2', text: 'With image' } } },
    ]);

    await postToX(makeCredentials(), 'With image', 'https://example.com/img.png');

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Media upload call
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://upload.twitter.com/1.1/media/upload.json',
    );

    // Tweet call with media
    const tweetBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(tweetBody.media).toEqual({ media_ids: ['media-123'] });
  });

  it('falls back to text-only tweet when image upload fails', async () => {
    mockFetchImageAsBuffer.mockRejectedValue(new Error('Fetch error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockFetchResponses([
      { ok: true, json: { data: { id: 'tweet-3', text: 'Fallback' } } },
    ]);

    await postToX(makeCredentials(), 'Fallback', 'https://example.com/img.png');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[X] Image upload failed'),
      expect.any(Error),
    );

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Only tweet call
  });

  it('falls back to text-only when media upload API returns error', async () => {
    mockFetchImageAsBuffer.mockResolvedValue({
      buffer: Buffer.from('fake-image-data'),
      contentType: 'image/png',
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockFetchResponses([
      { ok: false, status: 413, text: 'Too Large' }, // media upload fails
      { ok: true, json: { data: { id: 'tweet-4', text: 'Fallback' } } }, // tweet succeeds
    ]);

    await postToX(makeCredentials(), 'Fallback', 'https://example.com/img.png');

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('falls back to text-only when media upload returns no media_id_string', async () => {
    mockFetchImageAsBuffer.mockResolvedValue({
      buffer: Buffer.from('fake-image-data'),
      contentType: 'image/png',
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockFetchResponses([
      { ok: true, json: {} }, // media upload returns no media_id_string
      { ok: true, json: { data: { id: 'tweet-5', text: 'Fallback' } } },
    ]);

    await postToX(makeCredentials(), 'Fallback', 'https://example.com/img.png');

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('throws when tweet post fails', async () => {
    mockFetchResponses([
      { ok: false, status: 403, text: 'Forbidden' },
    ]);

    await expect(postToX(makeCredentials(), 'Test')).rejects.toThrow(
      '[X] POST /2/tweets failed: 403',
    );
  });

  it('throws when tweet response is missing data.id', async () => {
    mockFetchResponses([
      { ok: true, json: {} },
    ]);

    await expect(postToX(makeCredentials(), 'Test')).rejects.toThrow(
      '[X] Publish response missing post id',
    );
  });
});
