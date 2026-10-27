import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  FORMAT_DEFAULTS,
  PRESETS,
  getPreset,
  getTierSource,
  GENERATIONS,
  getFormatName,
  getValidFormats,
  getTiersForGen,
  getFallbackFormats,
  formatDisplayName,
} from '../formats';
// Types FormatDefaults and GenerationInfo validated by structural tests below
import { parseFormatId } from '../format-id';
import { clauseId } from '../clauses';
import { SEED_FORMAT_IDS } from '../seed-format-ids';

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

  it('lists the Smogon draft formats under the generations that have them', () => {
    expect(GENERATIONS.find((g) => g.num === 9)!.tiers).toEqual(expect.arrayContaining(['draft', 'natdexdraft', 'natdexlcdraft', 'doublesdraft', 'natdexdoublesdraft', 'doubles4draft', 'championsdraft', 'championsnatdexdraft', 'champions4doublesdraft']));
    expect(GENERATIONS.find((g) => g.num === 8)!.tiers).toEqual(expect.arrayContaining(['draft', 'natdexdraft', 'natdexdoubles4draft']));
    expect(GENERATIONS.find((g) => g.num === 3)!.tiers).toContain('draft');
    expect(GENERATIONS.find((g) => g.num === 2)!.tiers).not.toContain('draft');
    expect(GENERATIONS.find((g) => g.num === 1)!.tiers).toEqual(['ou', 'uu', 'nu', 'lc', 'ubers']);
  });

  it('keeps the legacy tier order of a generation, with the new formats after the ladder tiers they extend', () => {
    expect(GENERATIONS.find((g) => g.num === 7)!.tiers.slice(0, 15)).toEqual(['ou', 'uu', 'ru', 'nu', 'pu', 'zu', 'lc', 'nfe', 'ubers', 'ag', 'cap', 'doublesou', 'vgc', 'monotype', '1v1']);
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
    expect(getFormatName).toBe(catalog.getFormatName);
  });
});

// ── The preset catalog ─────────────────────────────────────────────

describe('PRESETS', () => {
  it('has one preset per format id of the catalog, each a valid id with its name, generation and tier', () => {
    expect(PRESETS.map((preset) => preset.id).sort()).toEqual(getValidFormats().filter((id) => id !== 'blank').sort());
    for (const preset of PRESETS) {
      expect(parseFormatId(preset.id), preset.id).toEqual({ gen: preset.gen, key: preset.tier });
      expect(preset.name, preset.id).toBe(`Gen ${preset.gen} ${preset.tierLabel}`);
      expect(getPreset(preset.id)).toBe(preset);
    }
    expect(getPreset('blank')).toBeUndefined();
    expect(getPreset(undefined)).toBeUndefined();
  });

  it('has the 17 Smogon draft formats of Showdown, mod by mod, all off the ladder search', () => {
    const drafts = PRESETS.filter((preset) => preset.source === 'smogon-draft');
    expect(drafts.map((preset) => preset.showdownId).sort()).toEqual(
      [
        'gen3draft', 'gen4draft', 'gen5draft', 'gen6draft', 'gen7draft', 'gen8draft', 'gen9draft',
        'gen8natdexdraft', 'gen9natdexdraft', 'gen9natdexlcdraft',
        'gen96v6doublesdraft', 'gen9natdex6v6doublesdraft', 'gen94v4doublesdraft', 'gen8natdex4v4doublesdraft',
        'gen9championsdraft', 'gen9championsnatdexdraft', 'gen9champions4v4doublesdraft',
      ].sort(),
    );
    expect(drafts).toHaveLength(17);
    expect(drafts.every((preset) => !preset.searchShow)).toBe(true);
    expect(drafts.filter((preset) => preset.mod === 'champions').map((preset) => preset.id)).toEqual([
      'gen9championsdraft', 'gen9championsnatdexdraft', 'gen9champions4doublesdraft',
    ]);
    expect(drafts.filter((preset) => preset.gameType === 'doubles')).toHaveLength(5);
    // The catalog ids avoid a leading digit in the key where Showdown's own id has one.
    expect(getPreset('gen9doublesdraft')?.showdownId).toBe('gen96v6doublesdraft');
    expect(getPreset('gen9doubles4draft')?.showdownId).toBe('gen94v4doublesdraft');
    expect(getPreset('gen9ou')).toMatchObject({ source: 'showdown', mod: 'gen9', universe: 'standard', showdownId: 'gen9ou', family: 'singles' });
    expect(getPreset('gen9ag')?.showdownId).toBe('gen9anythinggoes');
    expect(getPreset('gen9vgc')?.showdownId).toBeNull();
  });

  it('is Showdown-faithful: the clauses of each draft format are the ones its source defines', () => {
    const clauses = (id: string) => getPreset(id)!.clauses.map(clauseId);
    // Standard Draft: no Species Clause, no Moody, no Item Clause, no Terastal Clause.
    expect(clauses('gen9draft')).toEqual(['nicknameclause', 'sleepclausemod', 'ohkoclause', 'evasionclause', 'endlessbattleclause']);
    expect(clauses('gen8draft')).toEqual([...clauses('gen9draft'), 'dynamaxclause']);
    expect(clauses('gen5draft')).toEqual([...clauses('gen9draft'), 'drypassclause', 'gemsclause', 'sleepmovesclause']);
    // The gen 3 mod replaces Standard Draft with four more clauses.
    expect(clauses('gen3draft')).toEqual([...clauses('gen9draft'), 'oneboostpasserclause', 'freezeclausemod', 'accuracymovesclause', 'batonpasstrapclause']);
    // The Champions mod brings the Species Clause and repeals the Item Clause.
    expect(clauses('gen9championsdraft')).toEqual(['speciesclause', ...clauses('gen9draft')]);
    expect(clauses('gen9natdexlcdraft')).toEqual([...clauses('gen9draft'), 'itemclause']);
    expect(getPreset('gen9natdexlcdraft')!.rules).toMatchObject({ itemClauseLimit: 2, littleCup: true, maxLevel: 5 });
  });

  it('carries the rule facts of the source: team preview, level, team size, source generation', () => {
    expect(getPreset('gen3draft')!.rules.teamPreview).toBe(false);
    expect(getPreset('gen4draft')!.rules.teamPreview).toBe(false);
    expect(getPreset('gen5draft')!.rules.teamPreview).toBe(true);
    expect(getPreset('gen9draft')!.rules).toMatchObject({ minSourceGen: 9, unmodelled: ['min_source_gen'] });
    expect(getPreset('gen7draft')!.rules.unmodelled).toEqual(['lgpe_species']);
    expect(getPreset('gen9doubles4draft')!.rules).toMatchObject({ level: 50, pickedTeamSize: 4, itemClauseLimit: 1 });
    expect(getPreset('gen9natdexdoublesdraft')!.rules.minSourceGen).toBe(3);
    expect(getPreset('gen9championsdraft')!.rules).toMatchObject({ level: 50, minTeamSize: 6 });
    expect(getPreset('gen9ou')!.rules).toMatchObject({ teamPreview: true, level: null, littleCup: false, unmodelled: [] });
    expect(getPreset('gen4ou')!.rules.teamPreview).toBe(false);
    expect(getPreset('gen91v1')!.rules.pickedTeamSize).toBe(1);
  });

  it('flags the three presets with documented Smogon tour extras', () => {
    expect(PRESETS.filter((preset) => preset.tourOverlay).map((preset) => preset.id)).toEqual(['gen9natdexdraft', 'gen9natdexlcdraft', 'gen9doublesdraft']);
  });

  it('keeps ban lists out of the dex-free catalog', () => {
    expect(JSON.stringify(PRESETS)).not.toMatch(/banned_|Last Respects|Koraidon/);
    for (const preset of PRESETS) {
      expect(Object.keys(preset.rules).sort()).toEqual([
        'itemClauseLimit', 'level', 'littleCup', 'maxLevel', 'minSourceGen', 'minTeamSize', 'pickedTeamSize', 'teamPreview', 'unmodelled',
      ]);
    }
  });

  it('knows which source a tier key belongs to', () => {
    expect(getTierSource('ou')).toBe('showdown');
    expect(getTierSource('natdexdraft')).toBe('smogon-draft');
    expect(getTierSource('nope')).toBeUndefined();
  });
});

describe('format ids with a digit-led key', () => {
  it('formatDisplayName and getFallbackFormats read gen91v1 as generation 9', () => {
    expect(formatDisplayName('gen91v1')).toBe('Gen 9 1v1');
    expect(formatDisplayName('gen96v6doublesdraft')).toBe('Gen 9 6V6DOUBLESDRAFT');
    expect(getFallbackFormats('gen91v1')).toContain('gen9ou');
    expect(getFallbackFormats('gen91v1').every((id) => id.startsWith('gen9'))).toBe(true);
    expect(getFallbackFormats('gen91v1')).not.toContain('gen911v1');
  });

  it('gen9 alone is a generation, not a format with a tier', () => {
    expect(formatDisplayName('gen9')).toBe('gen9');
    expect(getFallbackFormats('gen9')).toEqual([]);
  });

  it('a draft format has no usage statistics and so no fallback; a National Dex format falls back to the singles ladder', () => {
    expect(getFallbackFormats('gen9natdexdraft')).toEqual([]);
    expect(getFallbackFormats('gen9championsdraft')).toEqual([]);
    expect(getFallbackFormats('gen9nationaldexuu')).toEqual(expect.arrayContaining(['gen9ou', 'gen9uu']));
    expect(getFallbackFormats('gen9doublesubers')).toEqual(['gen9doublesou', 'gen9vgc']);
    expect(getFallbackFormats('gen9doubleslc')).toEqual(['gen9doublesou', 'gen9vgc']);
  });
});

describe('the formats that existed before the preset catalog', () => {
  // A fingerprint of the 86 formats other than the National Dex ones, taken from the code before the catalog was
  // rebuilt on PRESETS: their names, clauses and bans are unchanged. (The National Dex formats were corrected on
  // purpose, below.) Changing one of these formats on purpose means recording the new fingerprint with the reason.
  const LEGACY_FINGERPRINT = '7705cbb62181b54f81a0ec8c00e4cb83bee398959d610e097ce7ec1ac0ad9187';

  it('keeps their clauses and bans', () => {
    const ids = SEED_FORMAT_IDS.filter((id) => !id.includes('nationaldex')).sort();
    const rows = ids.map((id) => {
      const d = FORMAT_DEFAULTS[id];
      return [id, d.name, d.gen, d.tier, d.is_doubles, d.clauses, d.banned_pokemon, d.banned_moves, d.banned_items];
    });
    expect(ids).toHaveLength(86);
    expect(createHash('sha256').update(JSON.stringify(rows)).digest('hex')).toBe(LEGACY_FINGERPRINT);
  });

  it('gives the National Dex formats the corrected bans: past species, Assist, Quick Claw, Last Respects, Shed Tail, Moody', () => {
    const natdex = FORMAT_DEFAULTS['gen9nationaldex'];
    expect(natdex.banned_pokemon).toEqual(expect.arrayContaining(['Mewtwo-Mega-X', 'Genesect', 'Koraidon']));
    expect(natdex.banned_moves).toEqual(['Assist', 'Baton Pass', 'Last Respects', 'Shed Tail']);
    expect(natdex.banned_items).toEqual(["King's Rock", 'Quick Claw', 'Razor Fang']);
    expect(natdex.banned_abilities).toEqual(['Arena Trap', 'Moody', 'Power Construct', 'Shadow Tag']);
    expect(FORMAT_DEFAULTS['gen8nationaldex'].banned_moves).toEqual(['Baton Pass']);
  });
});
