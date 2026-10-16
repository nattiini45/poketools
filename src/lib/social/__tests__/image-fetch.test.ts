import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock global fetch ────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch;
});

import { fetchImageAsBuffer } from '../image-fetch';

// ─── Tests ────────────────────────────────────────────────────────

describe('fetchImageAsBuffer', () => {
  it('returns a buffer and content type from a successful response', async () => {
    const fakeData = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeData.buffer),
      headers: new Map([['content-type', 'image/png']]),
    });

    // The headers need a .get method - fix mock
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeData.buffer),
      headers: {
        get: (name: string) => (name === 'content-type' ? 'image/png' : null),
      },
    });

    const result = await fetchImageAsBuffer('https://example.com/image.png');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.contentType).toBe('image/png');
    expect(result.buffer.length).toBe(fakeData.length);
  });

  it('defaults content type to image/png when header is missing', async () => {
    const fakeData = new Uint8Array([0xFF, 0xD8]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeData.buffer),
      headers: {
        get: () => null,
      },
    });

    const result = await fetchImageAsBuffer('https://example.com/image.jpg');
    expect(result.contentType).toBe('image/png');
  });

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    await expect(fetchImageAsBuffer('https://example.com/missing.png')).rejects.toThrow(
      'Failed to fetch social image: 404',
    );
  });

  it('passes the imageUrl to fetch', async () => {
    const fakeData = new Uint8Array([0]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeData.buffer),
      headers: { get: () => 'image/png' },
    });

    await fetchImageAsBuffer('https://cdn.example.com/avatar/123.png');
    expect(mockFetch).toHaveBeenCalledWith('https://cdn.example.com/avatar/123.png');
  });

  it('preserves content type from response headers', async () => {
    const fakeData = new Uint8Array([0]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeData.buffer),
      headers: { get: (name: string) => (name === 'content-type' ? 'image/webp' : null) },
    });

    const result = await fetchImageAsBuffer('https://example.com/image.webp');
    expect(result.contentType).toBe('image/webp');
  });

  it('propagates network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    await expect(fetchImageAsBuffer('https://example.com/image.png')).rejects.toThrow(
      'Network failure',
    );
  });
});
