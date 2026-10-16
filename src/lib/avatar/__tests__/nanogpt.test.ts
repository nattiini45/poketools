import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateImage } from '../nanogpt';

function mockFetchResponse(options: {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 500),
    json: () => Promise.resolve(options.json ?? {}),
    text: () => Promise.resolve(options.text ?? ''),
    headers: new Headers({ 'content-length': '1024' }),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  }));
}

describe('generateImage', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv, NANOGPT_API_KEY: 'test-nanogpt-key' };
  });

  it('throws when NANOGPT_API_KEY is missing', async () => {
    delete process.env.NANOGPT_API_KEY;

    await expect(generateImage({ prompt: 'test' })).rejects.toThrow(
      'Missing NANOGPT_API_KEY environment variable',
    );
  });

  it('sends correct request to NanoGPT API', async () => {
    mockFetchResponse({
      ok: true,
      json: { data: [{ b64_json: 'aW1hZ2VkYXRh' }] },
    });

    await generateImage({ prompt: 'Pokemon trainer', model: 'custom-model', size: '512x512' });

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://nano-gpt.com/v1/images/generations');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer test-nanogpt-key',
        'Content-Type': 'application/json',
      }),
    );

    const body = JSON.parse(call[1]?.body as string);
    expect(body).toEqual({
      model: 'custom-model',
      prompt: 'Pokemon trainer',
      n: 1,
      size: '512x512',
    });
  });

  it('uses default model and size when not provided', async () => {
    mockFetchResponse({
      ok: true,
      json: { data: [{ b64_json: 'aW1hZ2VkYXRh' }] },
    });

    await generateImage({ prompt: 'test' });

    const fetchMock = vi.mocked(globalThis.fetch);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.model).toBe('hidream');
    expect(body.size).toBe('1024x1024');
  });

  it('returns base64 data URL when b64_json is returned', async () => {
    mockFetchResponse({
      ok: true,
      json: { data: [{ b64_json: 'aW1hZ2VkYXRh' }] },
    });

    const result = await generateImage({ prompt: 'test' });

    expect(result).toBe('data:image/png;base64,aW1hZ2VkYXRh');
  });

  it('fetches image from URL when only url is returned', async () => {
    const imageBuffer = new ArrayBuffer(16);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        // First call: NanoGPT API
        ok: true,
        json: () => Promise.resolve({
          data: [{ url: 'https://cdn.nano-gpt.com/images/result.png' }],
        }),
      })
      .mockResolvedValueOnce({
        // Second call: image fetch
        ok: true,
        headers: new Headers({ 'content-length': '16' }),
        arrayBuffer: () => Promise.resolve(imageBuffer),
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await generateImage({ prompt: 'test' });

    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when API returns error status', async () => {
    mockFetchResponse({
      ok: false,
      status: 429,
      text: 'Rate limited',
    });

    await expect(generateImage({ prompt: 'test' })).rejects.toThrow(
      'NanoGPT API error (429): Rate limited',
    );
  });

  it('throws when no image data is returned', async () => {
    mockFetchResponse({
      ok: true,
      json: { data: [] },
    });

    await expect(generateImage({ prompt: 'test' })).rejects.toThrow(
      'NanoGPT returned no image data',
    );
  });

  it('throws when response has neither b64_json nor url', async () => {
    mockFetchResponse({
      ok: true,
      json: { data: [{}] },
    });

    await expect(generateImage({ prompt: 'test' })).rejects.toThrow(
      'NanoGPT response contained neither b64_json nor url',
    );
  });

  it('rejects non-HTTPS image URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ url: 'http://cdn.nano-gpt.com/images/result.png' }],
      }),
    }));

    await expect(generateImage({ prompt: 'test' })).rejects.toThrow(
      'Image URL must use HTTPS',
    );
  });

  it('rejects URLs with disallowed hosts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ url: 'https://evil.com/malicious.png' }],
      }),
    }));

    await expect(generateImage({ prompt: 'test' })).rejects.toThrow(
      'Image URL host not allowed: evil.com',
    );
  });

  it('allows replicate.delivery as a valid host', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ url: 'https://replicate.delivery/images/result.png' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '8' }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await generateImage({ prompt: 'test' });
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('throws when fetched image is too large (content-length)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ url: 'https://cdn.nano-gpt.com/images/huge.png' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': String(20 * 1024 * 1024) }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

    vi.stubGlobal('fetch', fetchMock);

    await expect(generateImage({ prompt: 'test' })).rejects.toThrow(
      'Image too large',
    );
  });

  it('throws when image fetch from URL fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ url: 'https://cdn.nano-gpt.com/images/result.png' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      });

    vi.stubGlobal('fetch', fetchMock);

    await expect(generateImage({ prompt: 'test' })).rejects.toThrow(
      'Failed to fetch generated image from URL: 404',
    );
  });
});
