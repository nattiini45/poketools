import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'de' }));

vi.mock('server-only', () => ({}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => state.locale,
    getDataLocale: async () => state.locale,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, state.locale),
  };
});

import {
  abilityMetadata,
  itemMetadata,
  moveMetadata,
  speciesMetadata,
  teraMetadata,
} from '../wiki-metadata';

beforeEach(() => {
  state.locale = 'en';
});

describe('wiki entity metadata', () => {
  it('titles a species by its name and describes its types', async () => {
    const meta = await speciesMetadata('garchomp');
    expect(meta.title).toBe('Garchomp');
    expect(meta.description).toContain('Garchomp');
    expect(meta.description).toContain('Dragon/Ground');
  });

  it('gives a move its name and its short game text', async () => {
    const meta = await moveMetadata('earthquake');
    expect(meta.title).toBe('Earthquake');
    expect(meta.description).toMatch(/^Earthquake: .+/);
  });

  it('describes an ability and an item with their own text', async () => {
    const ability = await abilityMetadata('intimidate');
    expect(ability.title).toBe('Intimidate');
    expect(ability.description).toMatch(/^Intimidate: .+/);
    const item = await itemMetadata('leftovers');
    expect(item.title).toBe('Leftovers');
    expect(item.description).toMatch(/^Leftovers: .+/);
  });

  it('titles a tera type page and resolves the URL case', async () => {
    const meta = await teraMetadata('fire');
    expect(meta.title).toBe('Fire Tera Type');
    expect(meta.description).toContain('Fire');
  });

  it('returns no metadata for an unknown entity so the page can 404 without a leaking title', async () => {
    expect(await speciesMetadata('not-a-real-pokemon')).toEqual({});
    expect(await moveMetadata('nope')).toEqual({});
    expect(await abilityMetadata('nope')).toEqual({});
    expect(await itemMetadata('nope')).toEqual({});
    expect(await teraMetadata('nope')).toEqual({});
  });

  it('follows the data locale for names and the UI locale for text', async () => {
    state.locale = 'de';
    const meta = await speciesMetadata('garchomp');
    expect(meta.title).toBe('Knakrack');
    expect(meta.description).toContain('Pokémon vom Typ');
    expect((await teraMetadata('fire')).title).toBe('Tera-Typ Feuer');
  });

  it('keeps descriptions short', async () => {
    for (const meta of [await moveMetadata('earthquake'), await itemMetadata('leftovers')]) {
      expect(String(meta.description).length).toBeLessThanOrEqual(200);
    }
  });
});