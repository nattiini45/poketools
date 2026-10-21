import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';

// Real @pkmn data and the generated German descriptions (no mocks; design pkmn-l10n.md §3.6, §5.4).
import { GET } from '../route';

interface Row {
  name: string;
  desc: string;
  descLang?: string;
}

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/pkmn/items');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString() } as unknown as NextRequest;
}

async function items(params: Record<string, string> = {}): Promise<{ status: number; data: Row[]; cache: string | null }> {
  const res = await GET(makeRequest(params));
  const json = (await res.json()) as { success: boolean; data: Row[] };
  expect(json.success).toBe(true);
  return { status: res.status, data: json.data, cache: res.headers.get('Cache-Control') };
}

describe('GET /api/pkmn/items', () => {
  it('lists English item descriptions by default, with a day-long public cache', async () => {
    const { status, data, cache } = await items();
    expect(status).toBe(200);
    const leftovers = data.find((r) => r.name === 'Leftovers');
    expect(leftovers?.desc).toBeTruthy();
    expect(leftovers?.descLang).toBeUndefined();
    expect(cache).toContain('max-age=86400');
  });

  it('?lang=de swaps in the German description and marks descLang', async () => {
    const english = (await items()).data.find((r) => r.name === 'Leftovers');
    const german = (await items({ lang: 'de' })).data.find((r) => r.name === 'Leftovers');
    expect(german?.descLang).toBe('de');
    expect(german?.desc).not.toBe(english?.desc);
  });

  it('treats an unsupported lang as en', async () => {
    const { data } = await items({ lang: 'fr' });
    expect(data.every((r) => r.descLang === undefined)).toBe(true);
  });
});
