import { describe, it, expect, vi, beforeEach } from 'vitest';

import { postToThreads } from '../threads';
import type { ThreadsCredentials } from '@/types/social';

function makeCredentials(overrides?: Partial<ThreadsCredentials>): ThreadsCredentials {
  return {
    provider: 'threads',
    access_token: 'threads-token-123',
    user_id: 'user-456',
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

describe('postToThreads', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a container then publishes a text-only post', async () => {
    mockFetchResponses([
      { ok: true, json: { id: 'container-1' } },
      { ok: true, json: { id: 'post-1' } },
    ]);

    await postToThreads(makeCredentials(), 'Hello Threads!');

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Create container call
    const createUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(createUrl.pathname).toBe('/v1.0/user-456/threads');
    expect(createUrl.searchParams.get('media_type')).toBe('TEXT');
    expect(createUrl.searchParams.get('text')).toBe('Hello Threads!');
    expect(createUrl.searchParams.get('access_token')).toBe('threads-token-123');
    expect(createUrl.searchParams.has('image_url')).toBe(false);

    // Publish call
    const publishUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(publishUrl.pathname).toBe('/v1.0/user-456/threads_publish');
    expect(publishUrl.searchParams.get('creation_id')).toBe('container-1');
  });

  it('sets media_type to IMAGE and includes image_url when provided', async () => {
    mockFetchResponses([
      { ok: true, json: { id: 'container-2' } },
      { ok: true, json: { id: 'post-2' } },
    ]);

    await postToThreads(makeCredentials(), 'With image', 'https://example.com/img.png');

    const fetchMock = vi.mocked(globalThis.fetch);
    const createUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(createUrl.searchParams.get('media_type')).toBe('IMAGE');
    expect(createUrl.searchParams.get('image_url')).toBe('https://example.com/img.png');
  });

  it('throws when create post fails', async () => {
    mockFetchResponses([
      { ok: false, status: 400, text: 'Bad Request' },
    ]);

    await expect(postToThreads(makeCredentials(), 'Test')).rejects.toThrow(
      '[Threads] Create post failed: 400',
    );
  });

  it('throws when create post response is missing id', async () => {
    mockFetchResponses([
      { ok: true, json: {} },
    ]);

    await expect(postToThreads(makeCredentials(), 'Test')).rejects.toThrow(
      '[Threads] Create post response missing creation id',
    );
  });

  it('throws when publish fails', async () => {
    mockFetchResponses([
      { ok: true, json: { id: 'container-1' } },
      { ok: false, status: 500, text: 'Internal Server Error' },
    ]);

    await expect(postToThreads(makeCredentials(), 'Test')).rejects.toThrow(
      '[Threads] Publish post failed: 500',
    );
  });

  it('throws when publish response is missing post id', async () => {
    mockFetchResponses([
      { ok: true, json: { id: 'container-1' } },
      { ok: true, json: {} },
    ]);

    await expect(postToThreads(makeCredentials(), 'Test')).rejects.toThrow(
      '[Threads] Publish response missing post id',
    );
  });
});
