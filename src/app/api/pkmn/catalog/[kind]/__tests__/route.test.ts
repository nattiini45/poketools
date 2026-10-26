import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { decodeIndex, type CatalogIndex, type CatalogText, type SpeciesRow } from '@/lib/pkmn/catalog-index';
import { GET } from '../route';

const call = (kind: string, query = '', headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost/api/pkmn/catalog/${kind}${query}`, { headers }), { params: Promise.resolve({ kind }) });

async function index(kind: string, query = ''): Promise<CatalogIndex> {
  const res = await call(kind, query);
  expect(res.status).toBe(200);
  return (await res.json()).data as CatalogIndex;
}

describe('GET /api/pkmn/catalog/[kind] (public)', () => {
  it('serves the gen 9 species index with ids, types, stats and sheet cells, cacheable for a long time', async () => {
    const res = await call('species', '?gen=9');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=86400');
    expect(res.headers.get('ETag')).toMatch(/^W\//);
    const data = (await res.json()).data as CatalogIndex<'species'>;
    const entries = decodeIndex(data);
    const charizard = entries.find((e) => e.id === 'charizard');
    expect(charizard).toMatchObject({ name: 'Charizard', types: ['Fire', 'Flying'], forme: false, mega: false, bst: 534 });
    // The icon sheet cell of Charizard: left -240 (column 6), top 0.
    expect(charizard?.ic).toBe(6);
    // The generation's own list leaves battle-only formes out, like the server's id sets.
    expect(entries.some((e) => e.id === 'aegislashblade')).toBe(false);
    expect(charizard?.battleOnly).toBe(false);
    expect(entries.some((e) => e.id === 'charizardmegax')).toBe(false);
  });

  it('the National Dex scope adds the Mega Evolutions and other past species, flagged', async () => {
    const entries = decodeIndex((await index('species', '?gen=9&scope=national')) as CatalogIndex<'species'>);
    const mega = entries.find((e) => e.id === 'mewtwomegax');
    expect(mega).toMatchObject({ mega: true, forme: true, baseId: 'mewtwo', past: true, battleOnly: false });
    // The National Dex list keeps battle-only formes (the server's id sets do) and flags them so pickers can hide them.
    expect(entries.find((e) => e.id === 'aegislashblade')?.battleOnly).toBe(true);
    expect(entries.length).toBeGreaterThan(1200);
  });

  it('moves, items and abilities have their own row shapes', async () => {
    const moves = decodeIndex((await index('moves', '?gen=9')) as CatalogIndex<'moves'>);
    expect(moves.find((m) => m.id === 'earthquake')).toMatchObject({ type: 'Ground', category: 'Physical', power: 100, accuracy: 100, pp: 10 });
    expect(moves.find((m) => m.id === 'swift')?.accuracy).toBeNull();
    const items = decodeIndex((await index('items', '?gen=9')) as CatalogIndex<'items'>);
    // The item sheet cell of Leftovers: left -48 (column 2), top -360 (row 15): 15 * 16 + 2.
    expect(items.find((i) => i.id === 'leftovers')).toMatchObject({ category: 'Other', ic: 242 });
    expect(items.find((i) => i.id === 'choiceband')?.category).toBe('Choice');
    const abilities = decodeIndex((await index('abilities', '?gen=9')) as CatalogIndex<'abilities'>);
    expect(abilities.find((a) => a.id === 'intimidate')).toMatchObject({ name: 'Intimidate', gen: 3 });
  });

  it('the text part carries descriptions in the asked language, German falling back to English per entry', async () => {
    const en = ((await (await call('abilities', '?gen=9&part=text')).json()).data) as CatalogText;
    expect(en.text.intimidate).toContain('Attack');
    expect(en.fallback).toEqual([]);
    const de = ((await (await call('abilities', '?gen=9&part=text&lang=de')).json()).data) as CatalogText;
    expect(de.lang).toBe('de');
    expect(de.text.intimidate).toBeTruthy();
    expect(de.fallback.length).toBeGreaterThan(0);
  });

  it('answers 304 to a matching ETag', async () => {
    const first = await call('abilities', '?gen=3');
    const etag = first.headers.get('ETag') as string;
    const second = await call('abilities', '?gen=3', { 'if-none-match': etag });
    expect(second.status).toBe(304);
  });

  it('an older generation has fewer entries', async () => {
    const gen3 = await index('species', '?gen=3');
    const gen9 = await index('species', '?gen=9');
    expect(gen3.rows.length).toBeLessThan(gen9.rows.length);
    expect(gen3.rows.length).toBeGreaterThan(300);
    expect((gen3.rows as SpeciesRow[]).some((row) => row[0] === 'garchomp')).toBe(false);
  });

  it('a Champions preset extends the rows with roster entries the dex files under a later generation', async () => {
    const plain = await index('species', '?gen=9');
    const extended = await index('species', '?gen=9&preset=gen9championsdraft');
    expect(extended.preset).toBe('gen9championsdraft');
    expect(extended.rows.length).toBeGreaterThanOrEqual(plain.rows.length);
    expect((await index('species', '?gen=9&preset=gen9ou')).preset).toBeNull();
  });

  it('refuses a kind, a generation, a scope, a part or a preset it does not know', async () => {
    expect((await call('pokemon')).status).toBe(404);
    expect((await call('species', '?gen=10')).status).toBe(400);
    expect((await call('species', '?gen=x')).status).toBe(400);
    expect((await call('species', '?scope=all')).status).toBe(400);
    expect((await call('species', '?part=text')).status).toBe(400);
    expect((await call('moves', '?part=other')).status).toBe(400);
    expect((await call('species', '?preset=nope')).status).toBe(400);
  });

  it('is deterministic and inside the size budget (gen 9 standard below 45 KB gzipped, national below 60 KB)', async () => {
    const standard = JSON.stringify(await index('species', '?gen=9'));
    expect(JSON.stringify(await index('species', '?gen=9'))).toBe(standard);
    const gz = (kind: string, scope: string) => call(kind, `?gen=9&scope=${scope}`).then((r) => r.text()).then((t) => gzipSync(t).length);
    const sizes = await Promise.all(['species', 'moves', 'items', 'abilities'].map((kind) => gz(kind, 'standard')));
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(45 * 1024);
    const national = await Promise.all(['species', 'moves', 'items', 'abilities'].map((kind) => gz(kind, 'national')));
    expect(national.reduce((a, b) => a + b, 0)).toBeLessThan(60 * 1024);
  });
});
