import { createHash } from 'node:crypto';
import { Dex } from '@pkmn/dex';
import { describe, expect, it } from 'vitest';
import { clauseId, getClause } from '../clauses';
import { PRESETS, getPreset, type RulesetPreset } from '../format-catalog';
import { toID } from '../i18n/id';
import { knownIds, presetKnownIds, type KnownIdKind } from '../known-ids.server';
import * as roster from '../preset-data/champions-roster.generated';
import { DRAFT_BANS, DRAFT_COMBINATION_BANS, DRAFT_TIER_BANS } from '../preset-data/draft';
import { PRESET_DATA_PIN, PRESET_RULES_VERSION } from '../preset-data/pin';
import * as standard from '../preset-data/standard';
import { TOUR_OVERLAYS } from '../preset-data/tour-overlay';

// Integrity of the committed preset data: every name exists in the dex for its generation and universe, the
// tables are internally consistent, and any edit of the data forces a PRESET_RULES_VERSION bump.

/**
 * The hash of everything a preset resolves from, by data version. Editing the catalog or a table changes the hash;
 * the test then fails until PRESET_RULES_VERSION is bumped (src/lib/pkmn/preset-data/pin.ts) and the new pair is
 * recorded here. Never change the hash of an existing version: a published ruleset version names it.
 */
const DATA_HASHES: Readonly<Record<string, string>> = {
  '2026-10-26.1': '2523ad1f88146ea0499a6015b2038746d3ffdb475e499405cdbfd94a631fb6c5',
  '2026-10-27.1': 'add971e53efe718d833a820650dd45185199de513dc278134320cbac6c3f0afa',
  '2026-10-27.2': 'c2665cb8ee8c068c193d3b00af1aabe6d14fb98e3186aae2cefc2f2b29ea2507',
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, inner]) => [key, canonical(inner)]),
    );
  }
  return value;
}

function dataHash(): string {
  const tables = {
    presets: PRESETS,
    standard: Object.fromEntries(Object.entries(standard).filter(([, value]) => typeof value !== 'function')),
    ladderBans: ['ou', 'uu', 'ru', 'nu', 'pu', 'ubers', 'doublesou', 'vgc'].flatMap((tier) =>
      [6, 7, 8, 9].map((gen) => [tier, gen, standard.ladderMoveBans(tier, gen), standard.ladderItemBans(tier, gen)]),
    ),
    draftBans: DRAFT_BANS,
    draftTierBans: DRAFT_TIER_BANS,
    draftCombinationBans: DRAFT_COMBINATION_BANS,
    overlays: TOUR_OVERLAYS,
    roster: Object.fromEntries(Object.entries(roster).filter(([key]) => key !== 'CHAMPIONS_ROSTER_PIN')),
    rosterPin: roster.CHAMPIONS_ROSTER_PIN,
    pin: PRESET_DATA_PIN,
  };
  return createHash('sha256').update(JSON.stringify(canonical(tables))).digest('hex');
}

describe('the data version', () => {
  it('is recorded with the hash of the data it covers (edit the data: bump PRESET_RULES_VERSION and record the new pair)', () => {
    expect(DATA_HASHES[PRESET_RULES_VERSION], `no hash recorded for PRESET_RULES_VERSION ${PRESET_RULES_VERSION}`).toBeDefined();
    expect(dataHash()).toBe(DATA_HASHES[PRESET_RULES_VERSION]);
  });

  it('pins both Showdown commits by a full sha', () => {
    expect(PRESET_DATA_PIN.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(roster.CHAMPIONS_ROSTER_PIN.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(PRESET_DATA_PIN.repo).toBe('smogon/pokemon-showdown');
    expect(roster.CHAMPIONS_ROSTER_PIN.repo).toBe('smogon/pokemon-showdown');
    expect(PRESET_DATA_PIN.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRESET_RULES_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

// ── Every name exists in the dex ─────────────────────────────────────

interface Named {
  where: string;
  kind: KnownIdKind;
  gen: number;
  universe: RulesetPreset['universe'];
  names: readonly string[];
}

function missing({ kind, gen, universe, names }: Named): string[] {
  const known = knownIds(kind, gen, universe);
  return names.filter((name) => !known.has(toID(name)));
}

function fromBans(where: string, gen: number, universe: RulesetPreset['universe'], bans: standard.RuleNames): Named[] {
  return [
    { where: `${where} pokemon`, kind: 'pokemon', gen, universe, names: bans.pokemon },
    { where: `${where} moves`, kind: 'moves', gen, universe, names: bans.moves },
    { where: `${where} items`, kind: 'items', gen, universe, names: bans.items },
    { where: `${where} abilities`, kind: 'abilities', gen, universe, names: bans.abilities },
  ];
}

describe('every name in the tables exists in the dex of its generation and universe', () => {
  it('the explicit banlists of the ladder formats (Gen 9)', () => {
    const checks = [
      ...fromBans('gen9lc', 9, 'standard', standard.GEN9_LC_BANS),
      ...fromBans('gen9monotype', 9, 'standard', standard.GEN9_MONOTYPE_BANS),
      ...fromBans('gen91v1', 9, 'standard', standard.GEN9_1V1_BANS),
      ...fromBans('gen9doubleslc', 9, 'standard', standard.GEN9_DOUBLES_LC_BANS),
      ...fromBans('gen9nationaldexdoublesubers', 9, 'national', standard.GEN9_NATIONAL_DEX_DOUBLES_UBERS_BANS),
    ];
    expect(checks.map((check) => [check.where, missing(check)]).filter(([, names]) => (names as string[]).length > 0)).toEqual([]);
  });

  it('the move and item bans of the tier families (one table for gens 6 to 9, so checked against the whole National Dex of Gen 9)', () => {
    const problems: string[] = [];
    for (const tier of ['ou', 'uu', 'ru', 'nu', 'pu', 'ubers']) {
      for (const gen of [6, 7, 8, 9]) {
        for (const [kind, names] of [['moves', standard.ladderMoveBans(tier, gen)], ['items', standard.ladderItemBans(tier, gen)]] as const) {
          for (const name of missing({ where: '', kind, gen: 9, universe: 'national', names })) problems.push(`gen${gen}${tier} ${kind}: ${name}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the National Dex family tables, per generation', () => {
    const problems: string[] = [];
    for (const [tier, byGen] of Object.entries(standard.NATIONAL_DEX_BANS)) {
      for (const [gen, bans] of Object.entries(byGen)) {
        for (const check of fromBans(`gen${gen}${tier}`, Number(gen), 'national', bans)) {
          for (const name of missing(check)) problems.push(`${check.where}: ${name}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the draft tables, in the universe of their preset', () => {
    const problems: string[] = [];
    for (const [id, bans] of Object.entries(DRAFT_BANS)) {
      const preset = getPreset(id);
      if (preset === undefined) throw new Error(`DRAFT_BANS names a preset the catalog does not have: ${id}`);
      for (const check of fromBans(id, preset.gen, preset.universe, bans)) for (const name of missing(check)) problems.push(`${check.where}: ${name}`);
    }
    expect(problems).toEqual([]);
  });

  it('the tour overlays (Gen 9, National Dex)', () => {
    const problems: string[] = [];
    for (const [id, overlay] of Object.entries(TOUR_OVERLAYS)) {
      for (const check of fromBans(`${id} overlay`, 9, 'national', overlay.bans)) for (const name of missing(check)) problems.push(`${check.where}: ${name}`);
    }
    expect(problems).toEqual([]);
  });

  it('the Champions roster, except the content the installed dex predates', () => {
    // Mega abilities of Pokémon Legends Z-A that Showdown has and `@pkmn/dex` 0.10.7 does not: this list shrinks when
    // the dex is upgraded, and the test then asks for it to be emptied.
    const dexLacks = ['auraguard', 'dragonize', 'eelevate', 'firemane', 'megasol', 'piercingdrill', 'spicyspray'];
    // The dex files the Z-A Megas under `Future`, so they are not in the National Dex universe but they exist.
    const dex = Dex.forGen(9);
    const absent = (kind: 'species' | 'items' | 'moves' | 'abilities', ids: readonly string[]) => ids.filter((id) => !dex[kind].get(id).exists).sort();
    const species = [...roster.CHAMPIONS_SPECIES_SELECTABLE, ...roster.CHAMPIONS_SPECIES_MEGA, ...roster.CHAMPIONS_SPECIES_BATTLE_ONLY, ...roster.CHAMPIONS_SPECIES_COSMETIC];
    expect(absent('species', species)).toEqual([]);
    expect(absent('items', roster.CHAMPIONS_ITEMS)).toEqual([]);
    expect(absent('moves', roster.CHAMPIONS_MOVES)).toEqual([]);
    expect(absent('abilities', roster.CHAMPIONS_ABILITIES)).toEqual([]);
    expect(absent('abilities', roster.CHAMPIONS_MEGA_ABILITIES)).toEqual(dexLacks);
  });
});

// ── The tables are consistent with the catalog ───────────────────────

describe('the tables agree with the catalog', () => {
  it('every draft table key is a draft preset, and the combination bans match the unmodelled facts', () => {
    for (const id of [...Object.keys(DRAFT_BANS), ...Object.keys(DRAFT_TIER_BANS), ...Object.keys(DRAFT_COMBINATION_BANS)]) {
      expect(getPreset(id)?.source, id).toBe('smogon-draft');
    }
    for (const preset of PRESETS) {
      expect(preset.rules.unmodelled.includes('combination_bans'), preset.id).toBe(DRAFT_COMBINATION_BANS[preset.id] !== undefined);
    }
  });

  it('the National Dex tables are for National Dex presets, in generations that have them', () => {
    for (const [tier, byGen] of Object.entries(standard.NATIONAL_DEX_BANS)) {
      for (const gen of Object.keys(byGen)) {
        const preset = getPreset(`gen${gen}${tier}`);
        expect(preset?.universe, `gen${gen}${tier}`).toBe('national');
      }
    }
    for (const preset of PRESETS.filter((entry) => entry.tier.startsWith('nationaldex') && entry.source === 'showdown')) {
      if (preset.tier === 'nationaldexdoublesubers') continue;
      expect(standard.NATIONAL_DEX_BANS[preset.tier]?.[preset.gen], preset.id).toBeDefined();
    }
  });

  it('every overlay is for a preset that flags it, uses known clauses, and removes only clauses the preset has', () => {
    expect(Object.keys(TOUR_OVERLAYS).sort()).toEqual(PRESETS.filter((preset) => preset.tourOverlay).map((preset) => preset.id).sort());
    for (const [id, overlay] of Object.entries(TOUR_OVERLAYS)) {
      const preset = getPreset(id);
      const own = new Set(preset?.clauses.map(clauseId));
      for (const name of [...overlay.clausesAdd, ...overlay.clausesRemove]) expect(getClause(name), `${id}: ${name}`).toBeDefined();
      for (const name of overlay.clausesRemove) expect(own.has(clauseId(name)), `${id} removes ${name}`).toBe(true);
      expect(overlay.sources.length, id).toBeGreaterThan(0);
      expect(overlay.sources.every((url) => /^https:\/\/www\.smogon\.com\/forums\/threads\//.test(url)), id).toBe(true);
      expect(overlay.bans.pokemon, id).toEqual([]);
    }
  });

  it('the generated Champions roster is sorted, unique and has the counts the Showdown source gave at the pin', () => {
    for (const [name, ids] of Object.entries(roster)) {
      if (!Array.isArray(ids)) continue;
      expect(ids, name).toEqual([...new Set(ids)].sort());
      expect((ids as string[]).every((id) => /^[a-z0-9]+$/.test(id)), name).toBe(true);
    }
    expect(roster.CHAMPIONS_SPECIES_SELECTABLE).toHaveLength(269);
    expect(roster.CHAMPIONS_SPECIES_MEGA).toHaveLength(82);
    expect(roster.CHAMPIONS_SPECIES_BATTLE_ONLY).toHaveLength(7);
    expect(roster.CHAMPIONS_SPECIES_COSMETIC).toHaveLength(24);
    expect(roster.CHAMPIONS_ITEMS).toHaveLength(166);
    expect(roster.CHAMPIONS_ABILITIES).toHaveLength(203);
    expect(roster.CHAMPIONS_MEGA_ABILITIES).toHaveLength(13);
    expect(roster.CHAMPIONS_MOVES).toHaveLength(510);
    expect(roster.CHAMPIONS_ROSTER_PIN).toMatchObject({ mod: 'champions', regulation: 'M-C' });
  });
});

describe('presetKnownIds', () => {
  it('adds the Champions roster to the dex universe for the Champions mod only', () => {
    const champions = getPreset('gen9championsdraft');
    const natdex = getPreset('gen9natdexdraft');
    if (champions === undefined || natdex === undefined) throw new Error('missing presets');
    expect(knownIds('pokemon', 9, 'national').has('baxcaliburmega')).toBe(false);
    expect(presetKnownIds(champions, 'pokemon').has('baxcaliburmega')).toBe(true);
    expect(presetKnownIds(champions, 'abilities').has('megasol')).toBe(true);
    expect(presetKnownIds(champions, 'pokemon').has('mewtwo')).toBe(true);
    expect(presetKnownIds(natdex, 'abilities').has('megasol')).toBe(false);
    expect(presetKnownIds(natdex, 'pokemon')).toBe(knownIds('pokemon', 9, 'national'));
  });

  it('is the generation itself for the standard universe and adds the past content for the National Dex', () => {
    expect(knownIds('pokemon', 9, 'standard').has('tapukoko')).toBe(false);
    expect(knownIds('pokemon', 9, 'national').has('tapukoko')).toBe(true);
    expect(knownIds('moves', 9, 'standard').has('hiddenpower')).toBe(false);
    expect(knownIds('moves', 9, 'national').has('hiddenpower')).toBe(true);
    expect(knownIds('items', 9, 'national').has('normaliumz')).toBe(true);
    expect(knownIds('abilities', 9, 'standard').has('intimidate')).toBe(true);
    expect(knownIds('pokemon', 9, 'standard')).toBe(knownIds('pokemon', 9, 'standard'));
  });
});
