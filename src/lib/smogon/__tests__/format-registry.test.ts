import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  STATS_FORMATS,
  fetchAvailableStatsFormats,
  getImportableFormats,
} from '../format-registry';

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ─── STATS_FORMATS ──────────────────────────────────────────────────

describe('STATS_FORMATS', () => {
  it('is a non-empty array of strings', () => {
    expect(Array.isArray(STATS_FORMATS)).toBe(true);
    expect(STATS_FORMATS.length).toBeGreaterThan(0);
    for (const f of STATS_FORMATS) {
      expect(typeof f).toBe('string');
    }
  });

  it('every format starts with gen followed by a digit', () => {
    for (const f of STATS_FORMATS) {
      expect(f).toMatch(/^gen\d/);
    }
  });

  it('includes common formats', () => {
    expect(STATS_FORMATS).toContain('gen9ou');
    expect(STATS_FORMATS).toContain('gen1ou');
    expect(STATS_FORMATS).toContain('gen9ubers');
    expect(STATS_FORMATS).toContain('gen9lc');
  });

  it('includes VGC formats', () => {
    expect(STATS_FORMATS).toContain('gen9vgc2024');
    expect(STATS_FORMATS).toContain('gen9vgc2025');
  });

  it('includes national dex formats', () => {
    expect(STATS_FORMATS).toContain('gen8nationaldex');
    expect(STATS_FORMATS).toContain('gen9nationaldex');
  });

  it('does not contain duplicates', () => {
    const unique = new Set(STATS_FORMATS);
    expect(unique.size).toBe(STATS_FORMATS.length);
  });
});

// ─── fetchAvailableStatsFormats ─────────────────────────────────────

describe('fetchAvailableStatsFormats', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    globalThis.fetch = mockFetch;
  });

  it('returns format keys from the stats index', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ gen9ou: 1, gen9uu: 1, gen8ou: 1 }),
    });

    const result = await fetchAvailableStatsFormats();

    expect(result).toEqual(['gen9ou', 'gen9uu', 'gen8ou']);
    expect(mockFetch).toHaveBeenCalledWith('https://pkmn.github.io/smogon/data/stats/index.json');
  });

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(fetchAvailableStatsFormats()).rejects.toThrow('Failed to fetch stats index: 404 Not Found');
  });

  it('returns empty array when index is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await fetchAvailableStatsFormats();
    expect(result).toEqual([]);
  });
});

// ─── getImportableFormats ───────────────────────────────────────────

describe('getImportableFormats', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    globalThis.fetch = mockFetch;
  });

  it('returns only formats that exist in both STATS_FORMATS and the remote index', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        gen9ou: 1,
        gen9uu: 1,
        gen9randomformat: 1, // not in STATS_FORMATS
      }),
    });

    const result = await getImportableFormats();

    expect(result).toContain('gen9ou');
    expect(result).toContain('gen9uu');
    expect(result).not.toContain('gen9randomformat');
  });

  it('falls back to the static list when the remote index has no matching formats', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        gen99custom: 1,
        gen99random: 1,
      }),
    });

    const result = await getImportableFormats();
    expect(result).toEqual(STATS_FORMATS);
  });

  it('falls back to the static list when the index fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await getImportableFormats();
    expect(result).toEqual(STATS_FORMATS);
  });

  it('discovers pattern-matching formats not in the static list', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        gen9vgc2027: 1, // future VGC season — not in STATS_FORMATS
        gen9ou: 1,
        gen9randombattle: 1, // not importable
      }),
    });

    const result = await getImportableFormats();
    expect(result).toContain('gen9vgc2027');
    expect(result).toContain('gen9ou');
    expect(result).not.toContain('gen9randombattle');
  });
});
