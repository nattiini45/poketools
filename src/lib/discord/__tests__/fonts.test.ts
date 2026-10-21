import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/promises before importing the module
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'fs/promises';
// loadFonts is accessed via dynamic import (vi.resetModules) in each test

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the module-level cache between tests by re-importing
  vi.resetModules();
});

function makeBuffer(size: number): Buffer {
  return Buffer.alloc(size, 0x41); // Fill with 'A'
}

describe('loadFonts', () => {
  it('reads three font files from public/fonts/', async () => {
    const buf1 = makeBuffer(100);
    const buf2 = makeBuffer(200);
    const buf3 = makeBuffer(300);

    vi.mocked(readFile)
      .mockResolvedValueOnce(buf1 as never)
      .mockResolvedValueOnce(buf2 as never)
      .mockResolvedValueOnce(buf3 as never);

    // Need to re-import to clear module-level cache
    const { loadFonts: freshLoadFonts } = await import('../fonts');
    const result = await freshLoadFonts();

    expect(readFile).toHaveBeenCalledTimes(3);

    // Verify paths contain expected font filenames
    const calls = vi.mocked(readFile).mock.calls;
    expect(String(calls[0][0])).toContain('Nunito-Bold.ttf');
    expect(String(calls[1][0])).toContain('DMSans-Regular.ttf');
    expect(String(calls[2][0])).toContain('DMSans-SemiBold.ttf');

    // Verify all three font data properties exist
    expect(result.nunito700).toBeDefined();
    expect(result.dmSans400).toBeDefined();
    expect(result.dmSans600).toBeDefined();
  });

  it('returns ArrayBuffer instances', async () => {
    const buf = makeBuffer(50);
    vi.mocked(readFile).mockResolvedValue(buf as never);

    const { loadFonts: freshLoadFonts } = await import('../fonts');
    const result = await freshLoadFonts();

    expect(result.nunito700).toBeInstanceOf(ArrayBuffer);
    expect(result.dmSans400).toBeInstanceOf(ArrayBuffer);
    expect(result.dmSans600).toBeInstanceOf(ArrayBuffer);
  });

  it('caches result on subsequent calls', async () => {
    const buf = makeBuffer(50);
    vi.mocked(readFile).mockResolvedValue(buf as never);

    const { loadFonts: freshLoadFonts } = await import('../fonts');

    const first = await freshLoadFonts();
    const second = await freshLoadFonts();

    // Only 3 reads on first call, none on second (cached)
    expect(readFile).toHaveBeenCalledTimes(3);
    expect(first).toBe(second);
  });

  it('propagates filesystem errors', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file'));

    const { loadFonts: freshLoadFonts } = await import('../fonts');

    await expect(freshLoadFonts()).rejects.toThrow('ENOENT');
  });
});
