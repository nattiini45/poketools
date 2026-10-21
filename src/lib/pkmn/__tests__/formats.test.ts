import { describe, it, expect } from 'vitest';
import {
  FORMAT_DEFAULTS,
  GENERATIONS,
  ALL_CLAUSES,
  getFormatDefaults,
  getFormatName,
  getValidFormats,
  getTiersForGen,
  getFallbackFormats,
  formatDisplayName,
} from '../formats';
// Types FormatDefaults and GenerationInfo validated by structural tests below

// ── GENERATIONS metadata ───────────────────────────────────────────

describe('GENERATIONS', () => {
  it('has 9 generations', () => {
    expect(GENERATIONS).toHaveLength(9);
  });

  it('generation numbers are 1 through 9', () => {
    const nums = GENERATIONS.map((g) => g.num);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('every generation has at least one tier', () => {
    for (const gen of GENERATIONS) {
      expect(gen.tiers.length).toBeGreaterThan(0);
    }
  });

  it('every generation has a shortName and label', () => {
    for (const gen of GENERATIONS) {
      expect(gen.shortName).toBeTruthy();
      expect(gen.label).toContain(`Gen ${gen.num}`);
    }
  });

  it('Gen 9 includes OU, VGC, monotype, and 1v1', () => {
    const gen9 = GENERATIONS.find((g) => g.num === 9)!;
    expect(gen9.tiers).toContain('ou');
    expect(gen9.tiers).toContain('vgc');
    expect(gen9.tiers).toContain('monotype');
    expect(gen9.tiers).toContain('1v1');
  });

  it('Gen 1 does not include VGC or modern tiers', () => {
    const gen1 = GENERATIONS.find((g) => g.num === 1)!;
    expect(gen1.tiers).not.toContain('vgc');
    expect(gen1.tiers).not.toContain('monotype');
    expect(gen1.tiers).not.toContain('ag');
  });
});

// ── FORMAT_DEFAULTS ────────────────────────────────────────────────

describe('FORMAT_DEFAULTS', () => {
  it('has a blank template', () => {
    expect(FORMAT_DEFAULTS['blank']).toBeDefined();
    expect(FORMAT_DEFAULTS['blank'].name).toBe('Custom Format');
    expect(FORMAT_DEFAULTS['blank'].tier).toBe('Custom');
    expect(FORMAT_DEFAULTS['blank'].clauses).toEqual([]);
  });

  it('has gen9ou with standard OU clauses', () => {
    const ou = FORMAT_DEFAULTS['gen9ou'];
    expect(ou).toBeDefined();
    expect(ou.name).toBe('Gen 9 OU');
    expect(ou.gen).toBe(9);
    expect(ou.is_doubles).toBe(false);
    expect(ou.clauses).toContain('Species Clause');
    expect(ou.clauses).toContain('Sleep Clause Mod');
    expect(ou.clauses).toContain('Moody Clause');
  });

  it('gen9ou bans include Baton Pass', () => {
    const ou = FORMAT_DEFAULTS['gen9ou'];
    expect(ou.banned_moves).toContain('Baton Pass');
  });

  it('gen9vgc is a doubles format', () => {
    const vgc = FORMAT_DEFAULTS['gen9vgc'];
    expect(vgc).toBeDefined();
    expect(vgc.is_doubles).toBe(true);
    expect(vgc.clauses).toContain('Species Clause');
    expect(vgc.clauses).toContain('Item Clause');
  });

  it('gen9ag has minimal clauses and no bans', () => {
    const ag = FORMAT_DEFAULTS['gen9ag'];
    expect(ag).toBeDefined();
    expect(ag.clauses).toEqual(['Endless Battle Clause']);
    expect(ag.banned_pokemon).toEqual([]);
    expect(ag.banned_moves).toEqual([]);
    expect(ag.banned_items).toEqual([]);
  });

  it('gen8ou includes Dynamax Clause', () => {
    const ou = FORMAT_DEFAULTS['gen8ou'];
    expect(ou).toBeDefined();
    expect(ou.clauses).toContain('Dynamax Clause');
  });

  it('gen9ou includes Terastal Clause', () => {
    const ou = FORMAT_DEFAULTS['gen9ou'];
    expect(ou.clauses).toContain('Terastal Clause');
  });

  it('gen9lc has explicit ban list for Gen 9', () => {
    const lc = FORMAT_DEFAULTS['gen9lc'];
    expect(lc).toBeDefined();
    expect(lc.banned_pokemon.length).toBeGreaterThan(0);
    expect(lc.banned_pokemon).toContain('Scyther');
    expect(lc.banned_moves).toContain('Baton Pass');
  });

  it('gen9monotype has explicit ban list', () => {
    const mono = FORMAT_DEFAULTS['gen9monotype'];
    expect(mono).toBeDefined();
    expect(mono.banned_pokemon.length).toBeGreaterThan(0);
    expect(mono.banned_pokemon).toContain('Arceus');
  });

  it('gen91v1 has explicit ban list', () => {
    const oneV1 = FORMAT_DEFAULTS['gen91v1'];
    expect(oneV1).toBeDefined();
    expect(oneV1.banned_pokemon.length).toBeGreaterThan(0);
    expect(oneV1.banned_items).toContain('Focus Sash');
  });

  it('gen9doublesou is doubles format', () => {
    const dou = FORMAT_DEFAULTS['gen9doublesou'];
    expect(dou).toBeDefined();
    expect(dou.is_doubles).toBe(true);
  });
});

// ── getFormatDefaults ──────────────────────────────────────────────

describe('getFormatDefaults', () => {
  it('returns matching format for known format ID', () => {
    const result = getFormatDefaults('gen9ou');
    expect(result.name).toBe('Gen 9 OU');
  });

  it('returns blank for unknown format ID', () => {
    const result = getFormatDefaults('gen99unknown');
    expect(result).toEqual(FORMAT_DEFAULTS['blank']);
  });
});

// ── getFormatName ──────────────────────────────────────────────────

describe('getFormatName', () => {
  it('returns display name for known format', () => {
    expect(getFormatName('gen9ou')).toBe('Gen 9 OU');
  });

  it('returns raw format string for unknown format', () => {
    expect(getFormatName('gen99mystery')).toBe('gen99mystery');
  });
});

// ── getValidFormats ────────────────────────────────────────────────

describe('getValidFormats', () => {
  it('returns array of format IDs including blank', () => {
    const formats = getValidFormats();
    expect(formats).toContain('blank');
    expect(formats).toContain('gen9ou');
    expect(formats).toContain('gen1ou');
  });

  it('returns more than 50 formats', () => {
    // 9 gens x varying tier counts + blank
    expect(getValidFormats().length).toBeGreaterThan(50);
  });
});

// ── getTiersForGen ─────────────────────────────────────────────────

describe('getTiersForGen', () => {
  it('returns tier options for Gen 9', () => {
    const tiers = getTiersForGen(9);
    expect(tiers.length).toBeGreaterThan(0);
    expect(tiers.find((t) => t.tier === 'ou')).toBeDefined();
    expect(tiers.find((t) => t.tier === 'vgc')).toBeDefined();
  });

  it('returns formatId in correct pattern', () => {
    const tiers = getTiersForGen(9);
    const ou = tiers.find((t) => t.tier === 'ou')!;
    expect(ou.formatId).toBe('gen9ou');
    expect(ou.label).toBe('OU');
  });

  it('returns empty array for invalid generation', () => {
    expect(getTiersForGen(0)).toEqual([]);
    expect(getTiersForGen(10)).toEqual([]);
  });
});

// ── getFallbackFormats ─────────────────────────────────────────────

describe('getFallbackFormats', () => {
  it('returns fallback tiers in same generation', () => {
    const fallbacks = getFallbackFormats('gen9ru');
    expect(fallbacks.length).toBeGreaterThan(0);
    expect(fallbacks.every((f) => f.startsWith('gen9'))).toBe(true);
    expect(fallbacks).not.toContain('gen9ru'); // excludes self
  });

  it('includes OU in singles fallbacks', () => {
    const fallbacks = getFallbackFormats('gen9nu');
    expect(fallbacks).toContain('gen9ou');
  });

  it('returns doubles fallbacks for doublesou', () => {
    const fallbacks = getFallbackFormats('gen9doublesou');
    expect(fallbacks).toContain('gen9vgc');
    expect(fallbacks).not.toContain('gen9doublesou');
  });

  it('special tiers fall back to singles ladder', () => {
    const fallbacks = getFallbackFormats('gen9monotype');
    expect(fallbacks).toContain('gen9ou');
  });

  it('returns empty for unrecognized format pattern', () => {
    expect(getFallbackFormats('invalid')).toEqual([]);
  });

  it('unknown tier falls back to OU', () => {
    const fallbacks = getFallbackFormats('gen9somethingnew');
    expect(fallbacks).toContain('gen9ou');
  });
});

// ── formatDisplayName ──────────────────────────────────────────────

describe('formatDisplayName', () => {
  it('converts gen9ou to "Gen 9 OU"', () => {
    expect(formatDisplayName('gen9ou')).toBe('Gen 9 OU');
  });

  it('converts gen1uu to "Gen 1 UU"', () => {
    expect(formatDisplayName('gen1uu')).toBe('Gen 1 UU');
  });

  it('converts gen9doublesou to "Gen 9 Doubles OU"', () => {
    expect(formatDisplayName('gen9doublesou')).toBe('Gen 9 Doubles OU');
  });

  it('returns raw format for unrecognized pattern', () => {
    expect(formatDisplayName('custom')).toBe('custom');
  });

  it('uppercases unknown tiers', () => {
    expect(formatDisplayName('gen9newtier')).toBe('Gen 9 NEWTIER');
  });
});

// ── ALL_CLAUSES ────────────────────────────────────────────────────

describe('ALL_CLAUSES', () => {
  it('contains standard clauses', () => {
    expect(ALL_CLAUSES).toContain('Species Clause');
    expect(ALL_CLAUSES).toContain('Sleep Clause Mod');
    expect(ALL_CLAUSES).toContain('Endless Battle Clause');
    expect(ALL_CLAUSES).toContain('Item Clause');
  });

  it('contains gen-specific clauses', () => {
    expect(ALL_CLAUSES).toContain('Dynamax Clause');
    expect(ALL_CLAUSES).toContain('Terastal Clause');
  });
});

// ── format-catalog parity (client-safe split) ──────────────────────

describe('format-catalog', () => {
  it('FORMAT_SUMMARIES has exactly the FORMAT_DEFAULTS keys and matching name/gen/tier/doubles/clauses', async () => {
    const catalog = await import('../format-catalog');
    expect(Object.keys(catalog.FORMAT_SUMMARIES).sort()).toEqual(Object.keys(FORMAT_DEFAULTS).sort());
    for (const [id, d] of Object.entries(FORMAT_DEFAULTS)) {
      expect(catalog.getFormatSummary(id)).toEqual({
        name: d.name,
        gen: d.gen,
        tier: d.tier,
        is_doubles: d.is_doubles,
        clauses: d.clauses,
      });
    }
  });

  it('formats.ts re-exports the catalog values', async () => {
    const catalog = await import('../format-catalog');
    expect(GENERATIONS).toBe(catalog.GENERATIONS);
    expect(ALL_CLAUSES).toBe(catalog.ALL_CLAUSES);
    expect(getFormatName).toBe(catalog.getFormatName);
  });
});
