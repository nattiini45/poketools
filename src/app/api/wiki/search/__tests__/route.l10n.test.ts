import { describe, it, expect } from 'vitest';

// Real @pkmn data and the generated German maps (no mocks): the wiki search matches German names in every
// category (design pkmn-l10n.md §5.4, §7). `route.test.ts` keeps the mocked unit tests.
import { GET } from '../route';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

interface Hit {
  type: string;
  name: string;
}

async function search(params: Record<string, string>): Promise<Hit[]> {
  const res = await GET(makeRequest(undefined, params));
  const body = (await res.json()) as { success: boolean; data: Hit[] };
  expect(body.success).toBe(true);
  return body.data;
}

describe('GET /api/wiki/search (real data, DE/EN)', () => {
  it('"Feuer" finds the Fire tera type', async () => {
    const hits = await search({ q: 'Feuer', type: 'tera' });
    expect(hits[0]).toEqual({ type: 'tera', name: 'Fire', shortDesc: '' });
  });

  it('"Feuer" finds the Fire tera type in an unfiltered search too', async () => {
    const hits = await search({ q: 'Feuer' });
    expect(hits).toContainEqual({ type: 'tera', name: 'Fire', shortDesc: '' });
  });

  it('"Glurak" finds Charizard', async () => {
    const hits = await search({ q: 'Glurak' });
    expect(hits[0]).toMatchObject({ type: 'pokemon', name: 'Charizard' });
  });

  it('German names with umlauts match their transliteration ("Ueberreste" → Leftovers)', async () => {
    const hits = await search({ q: 'Ueberreste', type: 'item' });
    expect(hits[0]).toMatchObject({ type: 'item', name: 'Leftovers' });
  });

  it('English tera queries keep working ("STEEL", "stellar")', async () => {
    expect((await search({ q: 'STEEL', type: 'tera' }))[0].name).toBe('Steel');
    expect((await search({ q: 'stellar', type: 'tera' })).map((h) => h.name)).toEqual(['Stellar']);
  });
});
