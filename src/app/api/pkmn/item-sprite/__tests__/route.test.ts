import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@pkmn/img', () => ({
  Icons: {
    getItem: vi.fn(),
  },
}));

import { GET } from '../route';
import { Icons } from '@pkmn/img';

const mockGetItem = Icons.getItem as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/pkmn/item-sprite');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { nextUrl: url, url: url.toString() } as unknown as NextRequest;
}

describe('GET /api/pkmn/item-sprite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns sprite data for a valid item', async () => {
    mockGetItem.mockReturnValue({ top: -10, left: -20, url: 'https://play.pokemonshowdown.com/sprites/itemicons-sheet.png' });

    const res = await GET(makeRequest({ item: 'Choice Band' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      top: -10,
      left: -20,
      url: 'https://play.pokemonshowdown.com/sprites/itemicons-sheet.png',
    });
    expect(mockGetItem).toHaveBeenCalledWith('Choice Band');
  });

  it('returns 400 when item param is missing', async () => {
    const res = await GET(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Missing item');
  });
});
