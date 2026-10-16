import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/formats', () => {
  const defaults = {
    clauses: ['Sleep Clause', 'Species Clause'],
    banlists: ['Uber', 'Arena Trap'],
    generation: 9,
    teamSize: 6,
    pickedSize: 6,
  };
  return {
    getFormatDefaults: vi.fn().mockReturnValue(defaults),
    FORMAT_DEFAULTS: {
      gen9ou: defaults,
      gen9uu: defaults,
    },
  };
});

const MOCK_DEFAULTS = {
  clauses: ['Sleep Clause', 'Species Clause'],
  banlists: ['Uber', 'Arena Trap'],
  generation: 9,
  teamSize: 6,
  pickedSize: 6,
};

import { GET } from '../route';
import { getFormatDefaults } from '@/lib/pkmn/formats';

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/pkmn/format-defaults');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return { url: url.toString() } as unknown as NextRequest;
}

describe('GET /api/pkmn/format-defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns format defaults for a valid format', async () => {
    const res = await GET(makeRequest({ format: 'gen9ou' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(MOCK_DEFAULTS);
    expect(getFormatDefaults).toHaveBeenCalledWith('gen9ou');
  });

  it('returns 400 when format is missing', async () => {
    const res = await GET(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Invalid format');
  });

  it('returns 400 for an unrecognized format', async () => {
    const res = await GET(makeRequest({ format: 'gen99xyz' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Invalid format');
  });

  it('recognizes valid formats from FORMAT_DEFAULTS keys', async () => {
    const res = await GET(makeRequest({ format: 'gen9uu' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(getFormatDefaults).toHaveBeenCalledWith('gen9uu');
  });
});
