import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';

// Real @pkmn data and the generated German maps (no mocks): bilingual search and `?lang=` descriptions
// (design pkmn-l10n.md §3.6, §5.4, §7). `route.test.ts` keeps the mocked unit tests.
import { GET } from '../route';
import { toID } from '@/lib/pkmn/i18n/id';

interface Row {
  name: string;
  id: string;
  shortDesc?: string;
  shortDescLang?: string;
}

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/pkmn/search');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString() } as unknown as NextRequest;
}

async function rows(params: Record<string, string>): Promise<Row[]> {
  const res = await GET(makeRequest(params));
  const json = (await res.json()) as { success: boolean; data: Row[] };
  expect(json.success).toBe(true);
  return json.data;
}

describe('GET /api/pkmn/search (real data, DE/EN)', () => {
  it('finds Charizard by its German name ?q=Glurak, returning the English name', async () => {
    const data = await rows({ q: 'Glurak' });
    expect(data[0]).toMatchObject({ name: 'Charizard', id: 'charizard' });
  });

  it('?lang=de rich rows carry the German shortDesc and shortDescLang', async () => {
    const english = await rows({ q: 'Choice Scarf', type: 'item', rich: '1' });
    const german = await rows({ q: 'Choice Scarf', type: 'item', rich: '1', lang: 'de' });
    const enScarf = english.find((r) => r.name === 'Choice Scarf');
    const deScarf = german.find((r) => r.name === 'Choice Scarf');

    expect(enScarf?.shortDescLang).toBeUndefined();
    expect(deScarf?.shortDescLang).toBe('de');
    expect(deScarf?.shortDesc).toContain('Initiative');
    expect(deScarf?.shortDesc).not.toBe(enScarf?.shortDesc);
  });

  it('?lang=de species-filtered move rows carry German descriptions', async () => {
    const data = await rows({ q: 'Kehrt', type: 'move', rich: '1', species: 'Landorus-Therian', lang: 'de' });
    const uturn = data.find((r) => r.name === 'U-turn');
    expect(uturn?.shortDescLang).toBe('de');
  });

  it('?lang=fr is treated as en', async () => {
    const english = await rows({ q: 'Choice Scarf', type: 'item', rich: '1' });
    const french = await rows({ q: 'Choice Scarf', type: 'item', rich: '1', lang: 'fr' });
    expect(french).toEqual(english);
    expect(french.every((r) => r.shortDescLang === undefined)).toBe(true);
  });

  it('list=1 abilities use the @pkmn id (toID of the name)', async () => {
    const data = await rows({ list: '1', type: 'ability', species: 'Ursaluna-Bloodmoon' });
    expect(data.map((a) => a.name)).toContain("Mind's Eye");
    for (const a of data) expect(a.id).toBe(toID(a.name));
  });

  it('list=1 abilities with ?lang=de carry German descriptions', async () => {
    const data = await rows({ list: '1', type: 'ability', species: 'Pikachu', lang: 'de' });
    expect(data[0]).toMatchObject({ name: 'Static', id: 'static', shortDescLang: 'de' });
  });
});
