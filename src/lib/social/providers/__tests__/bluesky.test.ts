import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../image-fetch', () => ({
  fetchImageAsBuffer: vi.fn(),
}));

import { postToBluesky } from '../bluesky';
import { fetchImageAsBuffer } from '../../image-fetch';
import type { BlueskyCredentials } from '@/types/social';

const mockFetchImageAsBuffer = vi.mocked(fetchImageAsBuffer);

function makeCredentials(overrides?: Partial<BlueskyCredentials>): BlueskyCredentials {
  return {
    provider: 'bluesky',
    handle: 'test.bsky.social',
    app_password: 'app-password-123',
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

describe('postToBluesky', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('creates a session then posts a text-only record', async () => {
    mockFetchResponses([
      // createSession
      { ok: true, json: { did: 'did:plc:abc', accessJwt: 'jwt-token' } },
      // createRecord
      { ok: true, json: { uri: 'at://did:plc:abc/app.bsky.feed.post/123' } },
    ]);

    await postToBluesky(makeCredentials(), 'Hello Bluesky!');

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Session call
    const sessionCall = fetchMock.mock.calls[0];
    expect(sessionCall[0]).toBe('https://bsky.social/xrpc/com.atproto.server.createSession');
    expect(JSON.parse(sessionCall[1]?.body as string)).toEqual({
      identifier: 'test.bsky.social',
      password: 'app-password-123',
    });

    // Record call
    const recordCall = fetchMock.mock.calls[1];
    expect(recordCall[0]).toBe('https://bsky.social/xrpc/com.atproto.repo.createRecord');
    const recordBody = JSON.parse(recordCall[1]?.body as string);
    expect(recordBody.repo).toBe('did:plc:abc');
    expect(recordBody.collection).toBe('app.bsky.feed.post');
    expect(recordBody.record.text).toBe('Hello Bluesky!');
    expect(recordBody.record.embed).toBeUndefined();
  });

  it('uses an operator-allowlisted service_url and strips the trailing slash', async () => {
    vi.stubEnv('BLUESKY_SERVICE_HOST_ALLOWLIST', 'custom.bsky.net');
    mockFetchResponses([
      { ok: true, json: { did: 'did:plc:abc', accessJwt: 'jwt-token' } },
      { ok: true, json: { uri: 'at://did:plc:abc/post/1' } },
    ]);

    await postToBluesky(
      makeCredentials({ service_url: 'https://custom.bsky.net/' }),
      'Test',
    );

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://custom.bsky.net/xrpc/com.atproto.server.createSession',
    );
  });

  it.each([
    ['http://bsky.social', 'not_https'],
    ['https://127.0.0.1', 'ip_literal'],
    ['https://[::1]', 'ip_literal'],
    ['https://localhost', 'local_host'],
    ['https://pds.internal', 'local_host'],
    ['https://bsky.social:8443', 'port'],
    ['https://user:pw@bsky.social', 'userinfo'],
    ['https://evil.example', 'host_not_allowed'],
  ])('refuses a stored service_url %s at send time without any request', async (serviceUrl, reason) => {
    mockFetchResponses([]);

    await expect(
      postToBluesky(makeCredentials({ service_url: serviceUrl }), 'Test'),
    ).rejects.toMatchObject({ name: 'BlueskyServiceUrlError', reason });

    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('never puts the rejected URL, handle or password in the error', async () => {
    mockFetchResponses([]);

    const err = await postToBluesky(
      makeCredentials({ service_url: 'https://evil.example/secret-path' }),
      'Test',
    ).then(() => new Error('did not throw'), (e: unknown) => e as Error);

    expect(err.message).not.toContain('evil.example');
    expect(err.message).not.toContain('app-password-123');
    expect(err.message).not.toContain('test.bsky.social');
  });

  it('sends every request without following redirects and with a deadline', async () => {
    mockFetchImageAsBuffer.mockResolvedValue({
      buffer: Buffer.from('fake-image'),
      contentType: 'image/png',
    });
    mockFetchResponses([
      { ok: true, json: { did: 'did:plc:abc', accessJwt: 'jwt-token' } },
      { ok: true, json: { blob: { $type: 'blob', ref: { $link: 'x' }, mimeType: 'image/png', size: 1 } } },
      { ok: true, json: { uri: 'at://did:plc:abc/post/1' } },
    ]);

    await postToBluesky(makeCredentials(), 'Test', 'https://example.com/img.png');

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls).toHaveLength(3);
    for (const [, init] of calls) {
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('caps an upstream error body in the thrown message', async () => {
    mockFetchResponses([{ ok: false, status: 400, text: 'x'.repeat(5000) }]);

    const err = await postToBluesky(makeCredentials(), 'Test').then(() => new Error('did not throw'), (e: unknown) => e as Error);

    expect(err.message.length).toBeLessThan(300);
  });

  it('defaults to bsky.social when service_url is empty', async () => {
    mockFetchResponses([
      { ok: true, json: { did: 'did:plc:abc', accessJwt: 'jwt-token' } },
      { ok: true, json: { uri: 'at://did:plc:abc/post/1' } },
    ]);

    await postToBluesky(makeCredentials({ service_url: '' }), 'Test');

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock.mock.calls[0][0]).toContain('bsky.social');
  });

  it('throws when session creation fails', async () => {
    mockFetchResponses([
      { ok: false, status: 401, text: 'Unauthorized' },
    ]);

    await expect(postToBluesky(makeCredentials(), 'Test')).rejects.toThrow(
      '[Bluesky] Session creation failed: 401',
    );
  });

  it('throws when session response is missing did/accessJwt', async () => {
    mockFetchResponses([
      { ok: true, json: { did: 'did:plc:abc' } }, // missing accessJwt
    ]);

    await expect(postToBluesky(makeCredentials(), 'Test')).rejects.toThrow(
      '[Bluesky] Session response missing did/accessJwt',
    );
  });

  it('throws when createRecord fails', async () => {
    mockFetchResponses([
      { ok: true, json: { did: 'did:plc:abc', accessJwt: 'jwt-token' } },
      { ok: false, status: 500, text: 'Server Error' },
    ]);

    await expect(postToBluesky(makeCredentials(), 'Test')).rejects.toThrow(
      '[Bluesky] createRecord failed: 500',
    );
  });

  it('throws when createRecord response is missing uri', async () => {
    mockFetchResponses([
      { ok: true, json: { did: 'did:plc:abc', accessJwt: 'jwt-token' } },
      { ok: true, json: {} }, // missing uri
    ]);

    await expect(postToBluesky(makeCredentials(), 'Test')).rejects.toThrow(
      '[Bluesky] createRecord response missing uri',
    );
  });

  it('uploads image and attaches embed when imageUrl is provided', async () => {
    mockFetchImageAsBuffer.mockResolvedValue({
      buffer: Buffer.from('fake-image'),
      contentType: 'image/png',
    });

    mockFetchResponses([
      // createSession
      { ok: true, json: { did: 'did:plc:abc', accessJwt: 'jwt-token' } },
      // uploadBlob
      {
        ok: true,
        json: {
          blob: {
            $type: 'blob',
            ref: { $link: 'bafk123' },
            mimeType: 'image/png',
            size: 1024,
          },
        },
      },
      // createRecord
      { ok: true, json: { uri: 'at://did:plc:abc/post/1' } },
    ]);

    await postToBluesky(makeCredentials(), 'With image', 'https://example.com/img.png');

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Verify blob upload call
    const blobCall = fetchMock.mock.calls[1];
    expect(blobCall[0]).toBe('https://bsky.social/xrpc/com.atproto.repo.uploadBlob');

    // Verify record has embed
    const recordBody = JSON.parse(fetchMock.mock.calls[2][1]?.body as string);
    expect(recordBody.record.embed).toBeDefined();
    expect(recordBody.record.embed.$type).toBe('app.bsky.embed.images');
  });

  it('falls back to text-only post when image upload fails', async () => {
    mockFetchImageAsBuffer.mockRejectedValue(new Error('Network error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockFetchResponses([
      // createSession
      { ok: true, json: { did: 'did:plc:abc', accessJwt: 'jwt-token' } },
      // createRecord (text-only fallback)
      { ok: true, json: { uri: 'at://did:plc:abc/post/1' } },
    ]);

    await postToBluesky(makeCredentials(), 'Fallback text', 'https://example.com/img.png');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Bluesky] Image upload failed'),
      expect.stringContaining('Network error'),
    );

    // Only 2 fetch calls (session + record), no blob upload
    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to text-only when uploadBlob API returns error', async () => {
    mockFetchImageAsBuffer.mockResolvedValue({
      buffer: Buffer.from('fake-image'),
      contentType: 'image/png',
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockFetchResponses([
      { ok: true, json: { did: 'did:plc:abc', accessJwt: 'jwt-token' } },
      { ok: false, status: 413, text: 'Payload Too Large' }, // uploadBlob fails
      { ok: true, json: { uri: 'at://did:plc:abc/post/1' } }, // createRecord succeeds
    ]);

    await postToBluesky(makeCredentials(), 'Fallback text', 'https://example.com/img.png');

    expect(consoleSpy).toHaveBeenCalled();
  });
});
