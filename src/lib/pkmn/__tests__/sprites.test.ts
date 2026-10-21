import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  normalizeItemName,
  getItemSpriteUrl,
  getCategorySpriteUrl,
  getBaseFormName,
} from '../sprites';
import { homeSpriteUrl } from '../sprite-styles';

// ─── normalizeName ────────────────────────────────────────────────

describe('normalizeName', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeName('')).toBe('');
  });

  it('lowercases simple names', () => {
    expect(normalizeName('Pikachu')).toBe('pikachu');
  });

  it('converts spaces to hyphens', () => {
    expect(normalizeName('Mr Mime')).toBe('mr-mime');
  });

  it('strips dots', () => {
    expect(normalizeName('Mr. Mime')).toBe('mr-mime');
  });

  it('strips apostrophes', () => {
    expect(normalizeName("Farfetch'd")).toBe('farfetchd');
  });

  it('preserves hyphens in form names', () => {
    expect(normalizeName('Rotom-Wash')).toBe('rotom-wash');
  });

  it('handles Nidoran female with gender symbol', () => {
    expect(normalizeName('Nidoran♀')).toBe('nidoran-f');
  });

  it('handles Nidoran male with gender symbol', () => {
    expect(normalizeName('Nidoran♂')).toBe('nidoran-m');
  });

  it('handles Nidoran female with f suffix', () => {
    expect(normalizeName('Nidoranf')).toBe('nidoran-f');
  });

  it('handles Nidoran male with m suffix', () => {
    expect(normalizeName('Nidoranm')).toBe('nidoran-m');
  });

  it('transliterates accented characters (e.g. Flabébé)', () => {
    expect(normalizeName('Flabébé')).toBe('flabebe');
  });

  it('collapses consecutive hyphens', () => {
    expect(normalizeName('test--name')).toBe('test-name');
  });

  it('trims leading and trailing hyphens', () => {
    expect(normalizeName('-test-')).toBe('test');
  });

  // Regional form expansion
  it('expands -galar to -galarian', () => {
    expect(normalizeName('Ponyta-Galar')).toBe('ponyta-galarian');
  });

  it('expands -alola to -alolan', () => {
    expect(normalizeName('Vulpix-Alola')).toBe('vulpix-alolan');
  });

  it('expands -hisui to -hisuian', () => {
    expect(normalizeName('Growlithe-Hisui')).toBe('growlithe-hisuian');
  });

  it('expands -paldea to -paldean', () => {
    expect(normalizeName('Tauros-Paldea')).toBe('tauros-paldean');
  });

  it('does not expand if suffix does not match', () => {
    expect(normalizeName('Rotom-Wash')).toBe('rotom-wash');
  });
});

// ─── homeSpriteUrl (moved from getSpriteUrl to ../sprite-styles) ─

describe('homeSpriteUrl', () => {
  const BASE = 'https://img.pokemondb.net/sprites/home';

  it('returns normal variant URL by default', () => {
    expect(homeSpriteUrl('Pikachu')).toBe(`${BASE}/normal/pikachu.png`);
  });

  it('returns shiny variant URL when shiny option is true', () => {
    expect(homeSpriteUrl('Pikachu', { shiny: true })).toBe(
      `${BASE}/shiny/pikachu.png`,
    );
  });

  it('returns normal variant URL when shiny option is false', () => {
    expect(homeSpriteUrl('Pikachu', { shiny: false })).toBe(
      `${BASE}/normal/pikachu.png`,
    );
  });

  it('normalizes the name in the URL', () => {
    expect(homeSpriteUrl('Mr. Mime')).toBe(`${BASE}/normal/mr-mime.png`);
  });

  it('handles regional forms', () => {
    expect(homeSpriteUrl('Ponyta-Galar')).toBe(
      `${BASE}/normal/ponyta-galarian.png`,
    );
  });
});

// ─── normalizeItemName ────────────────────────────────────────────

describe('normalizeItemName', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeItemName('')).toBe('');
  });

  it('lowercases and hyphenates item names', () => {
    expect(normalizeItemName('Choice Band')).toBe('choice-band');
  });

  it('handles single-word items', () => {
    expect(normalizeItemName('Leftovers')).toBe('leftovers');
  });

  it('handles Life Orb', () => {
    expect(normalizeItemName('Life Orb')).toBe('life-orb');
  });

  it('strips special characters', () => {
    expect(normalizeItemName("King's Rock")).toBe('kings-rock');
  });
});

// ─── getItemSpriteUrl ─────────────────────────────────────────────

describe('getItemSpriteUrl', () => {
  it('returns the Showdown CDN URL for an item', () => {
    expect(getItemSpriteUrl('Choice Scarf')).toBe(
      'https://play.pokemonshowdown.com/sprites/itemicons/choice-scarf.png',
    );
  });

  it('normalizes the item name', () => {
    expect(getItemSpriteUrl('Life Orb')).toBe(
      'https://play.pokemonshowdown.com/sprites/itemicons/life-orb.png',
    );
  });
});

// ─── getCategorySpriteUrl ─────────────────────────────────────────

describe('getCategorySpriteUrl', () => {
  it('returns Physical category URL', () => {
    expect(getCategorySpriteUrl('Physical')).toBe(
      'https://play.pokemonshowdown.com/sprites/categories/Physical.png',
    );
  });

  it('returns Special category URL', () => {
    expect(getCategorySpriteUrl('Special')).toBe(
      'https://play.pokemonshowdown.com/sprites/categories/Special.png',
    );
  });

  it('returns Status category URL', () => {
    expect(getCategorySpriteUrl('Status')).toBe(
      'https://play.pokemonshowdown.com/sprites/categories/Status.png',
    );
  });
});

// ─── getBaseFormName ──────────────────────────────────────────────

describe('getBaseFormName', () => {
  it('returns null for base-form names (no hyphen)', () => {
    expect(getBaseFormName('Pikachu')).toBeNull();
  });

  it('returns the base species name for form names', () => {
    expect(getBaseFormName('Rotom-Wash')).toBe('rotom');
  });

  it('returns the base species for regional forms', () => {
    // Ponyta-Galar normalizes to ponyta-galarian, base is ponyta
    expect(getBaseFormName('Ponyta-Galar')).toBe('ponyta');
  });

  it('returns the base species for complex forms', () => {
    expect(getBaseFormName('basculin-white-striped')).toBe('basculin');
  });

  it('returns null for empty string', () => {
    expect(getBaseFormName('')).toBeNull();
  });
});
