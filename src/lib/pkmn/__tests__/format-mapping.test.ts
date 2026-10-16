import { describe, it, expect } from 'vitest';
import {
  resolveStatsFormat,
  getGenFromBaseFormat,
  getTierFromBaseFormat,
  normalizeTierForSets,
} from '../format-mapping';

// ── resolveStatsFormat ──────────────────────────────────────────────

describe('resolveStatsFormat', () => {
  it('returns normalized format for gen9ou', () => {
    expect(resolveStatsFormat('gen9ou')).toBe('gen9ou');
  });

  it('returns normalized format for gen9uu', () => {
    expect(resolveStatsFormat('gen9uu')).toBe('gen9uu');
  });

  it('normalizes casing to lowercase', () => {
    expect(resolveStatsFormat('Gen9OU')).toBe('gen9ou');
  });

  it('strips non-alphanumeric characters', () => {
    expect(resolveStatsFormat('gen-9-ou')).toBe('gen9ou');
    expect(resolveStatsFormat('gen_9_ou')).toBe('gen9ou');
  });

  it('resolves gen9vgc alias to gen9vgc2025', () => {
    expect(resolveStatsFormat('gen9vgc')).toBe('gen9vgc2025');
  });

  it('resolves gen8vgc alias to gen8vgc2022', () => {
    expect(resolveStatsFormat('gen8vgc')).toBe('gen8vgc2022');
  });

  it('resolves gen7vgc alias to gen7vgc2019', () => {
    expect(resolveStatsFormat('gen7vgc')).toBe('gen7vgc2019');
  });

  it('returns the normalized string for gen9vgc2025 (no alias needed, passes through)', () => {
    expect(resolveStatsFormat('gen9vgc2025')).toBe('gen9vgc2025');
  });

  it('resolves alias with mixed casing', () => {
    expect(resolveStatsFormat('Gen9VGC')).toBe('gen9vgc2025');
  });

  it('returns null for empty string', () => {
    expect(resolveStatsFormat('')).toBeNull();
  });

  it('returns null for non-gen format', () => {
    expect(resolveStatsFormat('randombattle')).toBeNull();
  });

  it('returns null for format not starting with gen', () => {
    expect(resolveStatsFormat('ou')).toBeNull();
  });

  it('handles gen1ou correctly', () => {
    expect(resolveStatsFormat('gen1ou')).toBe('gen1ou');
  });

  it('handles spaces in format string', () => {
    expect(resolveStatsFormat('gen 9 ou')).toBe('gen9ou');
  });
});

// ── getGenFromBaseFormat ────────────────────────────────────────────

describe('getGenFromBaseFormat', () => {
  it('extracts gen 9 from gen9ou', () => {
    expect(getGenFromBaseFormat('gen9ou')).toBe(9);
  });

  it('extracts gen 8 from gen8uu', () => {
    expect(getGenFromBaseFormat('gen8uu')).toBe(8);
  });

  it('extracts gen 1 from gen1ou', () => {
    expect(getGenFromBaseFormat('gen1ou')).toBe(1);
  });

  it('handles mixed case', () => {
    expect(getGenFromBaseFormat('Gen9OU')).toBe(9);
  });

  it('defaults to 9 for empty string', () => {
    expect(getGenFromBaseFormat('')).toBe(9);
  });

  it('defaults to 9 when no gen prefix is found', () => {
    expect(getGenFromBaseFormat('ou')).toBe(9);
  });

  it('defaults to 9 for random non-gen string', () => {
    expect(getGenFromBaseFormat('randombattle')).toBe(9);
  });

  it('extracts generation from format with year suffix', () => {
    expect(getGenFromBaseFormat('gen9vgc2025')).toBe(9);
  });
});

// ── getTierFromBaseFormat ───────────────────────────────────────────

describe('getTierFromBaseFormat', () => {
  it('extracts ou from gen9ou', () => {
    expect(getTierFromBaseFormat('gen9ou')).toBe('ou');
  });

  it('extracts uu from gen8uu', () => {
    expect(getTierFromBaseFormat('gen8uu')).toBe('uu');
  });

  it('extracts vgc2025 from gen9vgc2025', () => {
    expect(getTierFromBaseFormat('gen9vgc2025')).toBe('vgc2025');
  });

  it('extracts vgc from Gen9VGC (case normalized)', () => {
    expect(getTierFromBaseFormat('Gen9VGC')).toBe('vgc');
  });

  it('returns empty string for empty input', () => {
    expect(getTierFromBaseFormat('')).toBe('');
  });

  it('returns full string lowered when no gen prefix', () => {
    // 'ou' -> 'ou'.replace(/^gen\d/i, '') -> 'ou' (no match)
    expect(getTierFromBaseFormat('ou')).toBe('ou');
  });

  it('handles uber tier', () => {
    expect(getTierFromBaseFormat('gen9ubers')).toBe('ubers');
  });

  it('handles monotype tier', () => {
    expect(getTierFromBaseFormat('gen9monotype')).toBe('monotype');
  });
});

// ── normalizeTierForSets ────────────────────────────────────────────

describe('normalizeTierForSets', () => {
  it('maps vgc2025 to vgc', () => {
    expect(normalizeTierForSets('vgc2025')).toBe('vgc');
  });

  it('maps vgc2022 to vgc', () => {
    expect(normalizeTierForSets('vgc2022')).toBe('vgc');
  });

  it('maps vgc2019 to vgc', () => {
    expect(normalizeTierForSets('vgc2019')).toBe('vgc');
  });

  it('maps bare vgc to vgc', () => {
    expect(normalizeTierForSets('vgc')).toBe('vgc');
  });

  it('passes through ou unchanged', () => {
    expect(normalizeTierForSets('ou')).toBe('ou');
  });

  it('passes through uu unchanged', () => {
    expect(normalizeTierForSets('uu')).toBe('uu');
  });

  it('passes through ubers unchanged', () => {
    expect(normalizeTierForSets('ubers')).toBe('ubers');
  });

  it('passes through empty string', () => {
    expect(normalizeTierForSets('')).toBe('');
  });

  it('passes through monotype unchanged', () => {
    expect(normalizeTierForSets('monotype')).toBe('monotype');
  });
});
