import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  searchSpecies: vi.fn().mockReturnValue(['Garchomp', 'Gardevoir']),
  searchMoves: vi.fn().mockReturnValue(['Earthquake', 'Earth Power']),
  searchItems: vi.fn().mockReturnValue(['Choice Band', 'Choice Scarf']),
  searchAbilities: vi.fn().mockReturnValue(['Rough Skin']),
  searchSpeciesRich: vi.fn().mockReturnValue([{ name: 'Garchomp', id: 'garchomp', types: ['Dragon', 'Ground'] }]),
  getLegalAbilities: vi.fn().mockReturnValue([{ name: 'Rough Skin' }, { name: 'Sand Veil' }]),
  getAbility: vi.fn().mockReturnValue({ shortDesc: 'Damages the attacker on contact.' }),
}));

// Language-aware rich/description searches (pkmn-l10n §3.6); real-data coverage in route.l10n.test.ts.
vi.mock('@/lib/pkmn/dex-l10n.server', () => ({
  searchMovesRich: vi.fn().mockReturnValue([{ name: 'Earthquake', id: 'earthquake', type: 'Ground' }]),
  searchItemsRich: vi.fn().mockReturnValue([{ name: 'Choice Band', id: 'choiceband' }]),
  searchAbilitiesRich: vi.fn().mockReturnValue([{ name: 'Rough Skin', id: 'roughskin' }]),
  searchMovesForSpecies: vi.fn().mockResolvedValue([{ name: 'Earthquake', legal: true }]),
  searchAbilitiesForSpecies: vi.fn().mockReturnValue([{ name: 'Rough Skin', legal: true }]),
  searchItemsByDescription: vi.fn().mockReturnValue([{ name: 'Leftovers' }]),
  searchAbilitiesByDescription: vi.fn().mockReturnValue([{ name: 'Levitate' }]),
}));

vi.mock('@/lib/pkmn/species-list', () => ({
  listSpeciesForFormat: vi
    .fn()
    .mockReturnValue([
      { name: 'Bulbasaur', types: ['Grass', 'Poison'], tier: 'LC', legal: true },
      { name: 'Charmander', types: ['Fire'], tier: 'LC', legal: true },
    ]),
}));

import { GET } from '../route';
import {
  searchSpecies, searchMoves, searchItems, searchAbilities,
  searchSpeciesRich,
  getLegalAbilities,
} from '@/lib/pkmn/dex';
import {
  searchMovesRich, searchItemsRich, searchAbilitiesRich,
  searchMovesForSpecies, searchAbilitiesForSpecies,
  searchItemsByDescription, searchAbilitiesByDescription,
} from '@/lib/pkmn/dex-l10n.server';
import { listSpeciesForFormat } from '@/lib/pkmn/species-list';

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/pkmn/search');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return { url: url.toString() } as unknown as NextRequest;
}

describe('GET /api/pkmn/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Basic species search ─────────────────────────────────────────

  it('searches species by name (default type)', async () => {
    const res = await GET(makeRequest({ q: 'gar' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toEqual(['Garchomp', 'Gardevoir']);
    expect(searchSpecies).toHaveBeenCalledWith('gar', 9);
  });

  it('searches species in rich mode', async () => {
    const res = await GET(makeRequest({ q: 'gar', rich: '1' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(searchSpeciesRich).toHaveBeenCalledWith('gar', 9);
  });

  // ── Move search ──────────────────────────────────────────────────

  it('searches moves by name', async () => {
    const res = await GET(makeRequest({ q: 'earth', type: 'move' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(searchMoves).toHaveBeenCalledWith('earth', 9);
  });

  it('searches moves rich', async () => {
    const res = await GET(makeRequest({ q: 'earth', type: 'moves', rich: '1' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(searchMovesRich).toHaveBeenCalledWith('earth', 9, undefined, { lang: 'en' });
  });

  it('searches moves for a specific species when species param is provided', async () => {
    const res = await GET(makeRequest({ q: 'earth', type: 'move', rich: '1', species: 'Garchomp' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(searchMovesForSpecies).toHaveBeenCalledWith('earth', 'Garchomp', 9, undefined, { lang: 'en' });
  });

  // ── Item search ──────────────────────────────────────────────────

  it('searches items by name', async () => {
    const res = await GET(makeRequest({ q: 'choice', type: 'item' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(searchItems).toHaveBeenCalledWith('choice', 9);
  });

  it('searches items by description', async () => {
    const res = await GET(makeRequest({ q: 'lefto', type: 'items', mode: 'description' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(searchItemsByDescription).toHaveBeenCalledWith('lefto', 9, undefined, { lang: 'en' });
  });

  it('searches items rich', async () => {
    const res = await GET(makeRequest({ q: 'choice', type: 'item', rich: '1' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(searchItemsRich).toHaveBeenCalledWith('choice', 9, undefined, { lang: 'en' });
  });

  // ── Ability search ───────────────────────────────────────────────

  it('searches abilities by name', async () => {
    const res = await GET(makeRequest({ q: 'rough', type: 'ability' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(searchAbilities).toHaveBeenCalledWith('rough', 9);
  });

  it('searches abilities rich', async () => {
    const res = await GET(makeRequest({ q: 'rough', type: 'abilities', rich: '1' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(searchAbilitiesRich).toHaveBeenCalledWith('rough', 9, undefined, { lang: 'en' });
  });

  it('searches abilities by description', async () => {
    const res = await GET(makeRequest({ q: 'levit', type: 'ability', mode: 'description' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(searchAbilitiesByDescription).toHaveBeenCalledWith('levit', 9, undefined, { lang: 'en' });
  });

  it('searches abilities for a specific species', async () => {
    const res = await GET(makeRequest({ q: 'rough', type: 'ability', rich: '1', species: 'Garchomp' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(searchAbilitiesForSpecies).toHaveBeenCalledWith('rough', 'Garchomp', 9, { lang: 'en' });
  });

  // ── list=1 mode ──────────────────────────────────────────────────

  it('lists all species in rich mode (no format → null)', async () => {
    const res = await GET(makeRequest({ list: '1', type: 'species' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(listSpeciesForFormat).toHaveBeenCalledWith(9, null);
  });

  it('passes a valid format through to listSpeciesForFormat', async () => {
    await GET(makeRequest({ list: '1', type: 'species', format: 'gen9ou' }));
    expect(listSpeciesForFormat).toHaveBeenCalledWith(9, 'gen9ou');
  });

  it('ignores an invalid format (passes null)', async () => {
    await GET(makeRequest({ list: '1', type: 'species', format: 'gen9ou; DROP TABLE' }));
    expect(listSpeciesForFormat).toHaveBeenCalledWith(9, null);
  });

  it('sets long cache headers on the species list response', async () => {
    const res = await GET(makeRequest({ list: '1', type: 'species' }));
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
  });

  it('lists legal abilities for a species', async () => {
    const res = await GET(makeRequest({ list: '1', type: 'ability', species: 'Garchomp' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(getLegalAbilities).toHaveBeenCalledWith('Garchomp', 9);
  });

  // ── Edge cases ───────────────────────────────────────────────────

  it('returns empty array when query is too short', async () => {
    const res = await GET(makeRequest({ q: 'a' }));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });

  it('returns empty array when query is missing', async () => {
    const res = await GET(makeRequest({}));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
  });

  it('returns 400 for an invalid type', async () => {
    const res = await GET(makeRequest({ q: 'test', type: 'invalid' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('type must be');
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: 'type must be species, move, item, or ability' });
  });

  // ── ?lang= pass-through (pkmn-l10n §3.6) ─────────────────────────

  it('passes lang=de to the language-aware rich searches', async () => {
    await GET(makeRequest({ q: 'earth', type: 'move', rich: '1', lang: 'de' }));
    expect(searchMovesRich).toHaveBeenCalledWith('earth', 9, undefined, { lang: 'de' });

    await GET(makeRequest({ q: 'rough', type: 'ability', rich: '1', species: 'Garchomp', lang: 'de' }));
    expect(searchAbilitiesForSpecies).toHaveBeenCalledWith('rough', 'Garchomp', 9, { lang: 'de' });

    await GET(makeRequest({ q: 'reste', type: 'item', mode: 'description', lang: 'de' }));
    expect(searchItemsByDescription).toHaveBeenCalledWith('reste', 9, undefined, { lang: 'de' });
  });

  it('treats an unsupported or empty lang as en', async () => {
    await GET(makeRequest({ q: 'earth', type: 'move', rich: '1', lang: 'fr' }));
    expect(searchMovesRich).toHaveBeenLastCalledWith('earth', 9, undefined, { lang: 'en' });

    await GET(makeRequest({ q: 'earth', type: 'move', rich: '1', lang: '' }));
    expect(searchMovesRich).toHaveBeenLastCalledWith('earth', 9, undefined, { lang: 'en' });
  });

  it('keeps name-only searches language-neutral', async () => {
    await GET(makeRequest({ q: 'gar', lang: 'de' }));
    expect(searchSpecies).toHaveBeenCalledWith('gar', 9);
  });

  it('gives list=1 abilities the @pkmn id', async () => {
    vi.mocked(getLegalAbilities).mockReturnValueOnce([{ name: "Mind's Eye", slot: '0' }, { name: 'Sand Veil', slot: 'H' }]);
    const res = await GET(makeRequest({ list: '1', type: 'ability', species: 'Ursaluna-Bloodmoon' }));
    const json = await res.json();

    expect(json.data.map((a: { id: string }) => a.id)).toEqual(['mindseye', 'sandveil']);
    expect(json.data[0]).not.toHaveProperty('shortDescLang');
  });

  it('respects gen parameter', async () => {
    await GET(makeRequest({ q: 'gar', gen: '5' }));
    expect(searchSpecies).toHaveBeenCalledWith('gar', 5);
  });

  it('defaults to gen 9 for invalid gen', async () => {
    await GET(makeRequest({ q: 'gar', gen: 'abc' }));
    expect(searchSpecies).toHaveBeenCalledWith('gar', 9);
  });

  it('sets long cache headers on search responses', async () => {
    const res = await GET(makeRequest({ q: 'gar' }));
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
  });
});
