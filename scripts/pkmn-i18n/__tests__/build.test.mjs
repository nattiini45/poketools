// Pure-builder tests for scripts/pkmn-i18n/build.mjs (design pkmn-l10n.md §7, PK-1 row): tiny hand-made PokeAPI CSVs
// plus a fake @pkmn universe. No network, no cache, no @pkmn import.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll, parseCsv, serialize, cleanFlavor, sortDeep, toID } from '../build.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadTables() {
  const tables = {};
  for (const f of readdirSync(FIXTURES).filter((n) => n.endsWith('.csv'))) {
    tables[f.replace(/\.csv$/, '')] = parseCsv(readFileSync(join(FIXTURES, f), 'utf8'));
  }
  return tables;
}

// Deliberately NOT in sorted order: the output must be sorted regardless.
const SPECIES = [
  ['pikachualola', { name: 'Pikachu-Alola', num: 25, forme: 'Alola' }],
  ['charizard', { name: 'Charizard', num: 6, forme: '' }],
  ['charizardmegax', { name: 'Charizard-Mega-X', num: 6, forme: 'Mega-X' }],
  ['charizardmegay', { name: 'Charizard-Mega-Y', num: 6, forme: 'Mega-Y' }],
  ['charizardgmax', { name: 'Charizard-Gmax', num: 6, forme: 'Gmax' }],
  ['ninetalesalola', { name: 'Ninetales-Alola', num: 38, forme: 'Alola' }],
  ['raticatealolatotem', { name: 'Raticate-Alola-Totem', num: 20, forme: 'Alola-Totem' }],
  ['darmanitangalarzen', { name: 'Darmanitan-Galar-Zen', num: 555, forme: 'Galar-Zen' }],
  ['kyogreprimal', { name: 'Kyogre-Primal', num: 382, forme: 'Primal' }],
  ['mimikyutotem', { name: 'Mimikyu-Totem', num: 778, forme: 'Totem' }],
  ['meowsticf', { name: 'Meowstic-F', num: 678, forme: 'F', gender: 'F' }],
  ['unownf', { name: 'Unown-F', num: 201, forme: 'F', gender: 'N' }],
  ['rotomheat', { name: 'Rotom-Heat', num: 479, forme: 'Heat' }],
  ['lycanrocdusk', { name: 'Lycanroc-Dusk', num: 745, forme: 'Dusk' }],
  ['enamorustherian', { name: 'Enamorus-Therian', num: 905, forme: 'Therian' }],
  ['fakemon', { name: 'Fakemon', num: 9999, forme: '' }],
  ['', { name: '', num: 0, forme: '' }],
];

function universes() {
  return {
    species: new Map(SPECIES),
    moves: new Map([
      ['stealthrock', { name: 'Stealth Rock' }],
      ['pound', { name: 'Pound' }],
      ['guillotine', { name: 'Guillotine' }],
      ['testmove', { name: 'Test Move' }],
      ['grassyterrain', { name: 'Grassy Terrain' }],
      ['mistyterrain', { name: 'Misty Terrain' }],
      ['electricterrain', { name: 'Electric Terrain' }],
      ['psychicterrain', { name: 'Psychic Terrain' }],
      ['nomove', { name: 'No Move' }],
    ]),
    items: new Map([
      ['pokeball', { name: 'Poké Ball' }],
      ['berry', { name: 'Berry' }],
    ]),
    abilities: new Map([
      ['guts', { name: 'Guts' }],
      ['embodyaspectteal', { name: 'Embody Aspect (Teal)' }],
    ]),
    natures: new Map([['adamant', { name: 'Adamant' }]]),
    types: new Map([
      ['stellar', { name: 'Stellar' }],
      ['fire', { name: 'Fire' }],
      ['', { name: '???' }],
    ]),
  };
}

const MISC = {
  statsShort: { hp: 'KP', atk: 'Angr.', def: 'Vert.', spa: 'Sp.-Angr.', spd: 'Sp.-Vert.', spe: 'Init.' },
  status: { brn: { short: 'BRT', long: 'Verbrennung' } },
  weather: { Sun: 'Sonne', Rain: 'Regen' },
};

function overrides(extra = {}) {
  return {
    forms: { pikachualola: 'Pikachu (Alola-Kappe)' },
    abilities: { embodyaspectteal: 'Erinnerungskraft (Türkisgrün)' },
    items: {},
    misc: MISC,
    desc: {},
    ...extra,
  };
}

const build = (extra) => buildAll({ tables: loadTables(), universes: universes(), overrides: overrides(extra) });

function expectSortedDeep(value, path = '$') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const keys = Object.keys(value);
  expect(keys, `${path} keys sorted`).toEqual([...keys].sort());
  for (const k of keys) expectSortedDeep(value[k], `${path}.${k}`);
}

describe('parseCsv', () => {
  it('handles a BOM, quotes, doubled quotes, embedded newlines and CRLF', () => {
    const rows = parseCsv('﻿a,b,c\r\n1,"x, ""y""",\r\n2,"multi\nline",z\r\n\r\n');
    expect(rows).toEqual([
      { a: '1', b: 'x, "y"', c: '' },
      { a: '2', b: 'multi\nline', c: 'z' },
    ]);
  });
});

describe('buildAll', () => {
  it('(a) is deterministic: two runs are deep-equal, serialise byte-identically, and every map is key-sorted', () => {
    const first = build();
    const second = build();
    expect(second).toEqual(first);
    for (const [file, data] of Object.entries(first.files)) {
      expect(serialize(second.files[file])).toBe(serialize(data));
      expectSortedDeep(data, file);
    }
    expect(serialize({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}\n');
    expect(sortDeep([{ b: 1, a: 2 }])).toEqual([{ a: 2, b: 1 }]);
  });

  it('(b) keeps the LOWEST PokeAPI id on duplicate English names (two "Poké Ball" rows), so the flavour text survives', () => {
    const { files } = build();
    expect(files['items.de.json'].pokeball).toBe('Pokéball');
    expect(files['items.desc.de.json'].pokeball).toBe('Damit fängst du wilde Pokémon.');
  });

  it('(c) applies the species rules in order', () => {
    const species = build().files['species.de.json'];
    expect(species.charizard).toBe('Glurak');
    expect(species.ninetalesalola).toBe('Alola-Vulnona'); // region rule
    expect(species.raticatealolatotem).toBe('Alola-Rattikarl (Totem)'); // region + Totem
    expect(species.darmanitangalarzen).toBe('Galar-Flampivian (Trance)'); // region + Zen
    expect(species.charizardmegax).toBe('Mega-Glurak X');
    expect(species.charizardmegay).toBe('Mega-Glurak Y');
    expect(species.kyogreprimal).toBe('Proto-Kyogre');
    expect(species.charizardgmax).toBe('Gigadynamax-Glurak');
    expect(species.mimikyutotem).toBe('Mimigma (Totem)');
    expect(species.meowsticf).toBe('Psiaugon (weiblich)'); // F rule, gender form only
    expect(species.rotomheat).toBe('Hitze-Rotom'); // PokeAPI full name
    expect(species.lycanrocdusk).toBe('Wolwerock (Zwielicht)'); // PokeAPI full name
    expect(species.enamorustherian).toBe('Cupidos (Tiergeistform)'); // label only
  });

  it('(c) an override beats every rule, including the region rule for pikachualola', () => {
    const species = build().files['species.de.json'];
    expect(species.pikachualola).toBe('Pikachu (Alola-Kappe)');
    const withoutOverride = build({ forms: {} }).files['species.de.json'];
    expect(withoutOverride.pikachualola).toBe('Alola-Pikachu');
    const reviewed = build({ forms: { enamorustherian: 'Cupidos (Tiergeist)' } }).files['species.de.json'];
    expect(reviewed.enamorustherian).toBe('Cupidos (Tiergeist)');
  });

  it('(c) other kinds: overrides, the identifier fallback, quote normalisation, misc labels', () => {
    const { files } = build();
    expect(files['moves.de.json'].stealthrock).toBe('Tarnsteine');
    expect(files['moves.de.json'].guillotine).toBe('Guillotine'); // no English row: identifier fallback
    expect(files['moves.de.json'].testmove).toBe("Test's Zug"); // ’ -> '
    expect(files['abilities.de.json']).toEqual({ embodyaspectteal: 'Erinnerungskraft (Türkisgrün)', guts: 'Adrenalin' });
    const misc = files['misc.de.json'];
    expect(misc.types).toEqual({ fire: 'Feuer', stellar: 'Stellar' });
    expect(misc.natures).toEqual({ adamant: 'Hart' });
    expect(misc.stats.long.spa).toBe('Spezialangriff');
    expect(misc.stats.short.spa).toBe('Sp.-Angr.');
    expect(misc.categories).toEqual({ Physical: 'Physisch', Special: 'Spezial', Status: 'Status' });
    expect(misc.terrain).toEqual({ Electric: 'Elektrofeld', Grassy: 'Grasfeld', Misty: 'Nebelfeld', Psychic: 'Psychofeld' });
    expect(misc.weather).toEqual({ Rain: 'Regen', Sun: 'Sonne' });
    expect(misc.status.brn).toEqual({ long: 'Verbrennung', short: 'BRT' });
  });

  it('(d) ranks flavour text SV > SwSh > XY, with Legends: Arceus and Z-A below SwSh, and cleans it', () => {
    const { files, report } = build();
    // Pound has a German SV row: it wins, soft hyphen + line break removed, "-\n" joined, whitespace collapsed.
    expect(files['moves.desc.de.json'].pound).toBe('Ein Hieb mit Pranken oder Schweif. Volltreffer-chance hoch.');
    // Stealth Rock has XY, SwSh, LA and Z-A rows: SwSh wins over the later but non-standard LA / Z-A.
    expect(files['moves.desc.de.json'].stealthrock).toBe('Tarnsteine SwSh.');
    expect(report.descVersionGroups.moves).toEqual({ 20: 1, 25: 1 });
    // Embody Aspect variants read the single PokeAPI ability.
    expect(files['abilities.desc.de.json'].embodyaspectteal).toBe('Erinnerungskraft Text.');
    // No German row: no entry (English fallback at runtime).
    expect(files['moves.desc.de.json']).not.toHaveProperty('guillotine');
  });

  it('(d) desc.de.json overrides win over PokeAPI and reject malformed keys', () => {
    const { files } = build({ desc: { 'move:stealthrock': 'Offizieller KP-Text.', 'item:berry': 'Beerentext.' } });
    expect(files['moves.desc.de.json'].stealthrock).toBe('Offizieller KP-Text.');
    expect(files['items.desc.de.json'].berry).toBe('Beerentext.');
    expect(() => build({ desc: { 'Stealth Rock': 'x' } })).toThrow(/bad key/);
    expect(() => build({ desc: { 'move:pound': '  ' } })).toThrow(/empty text/);
  });

  it('cleanFlavor removes U+00AD with the following whitespace and joins hyphenated line breaks', () => {
    expect(cleanFlavor('Spe­\nzial-\nAngriff\fhoch  ')).toBe('Spezial-Angriff hoch');
  });

  it('(e) reports missing ids instead of dropping them silently', () => {
    const { files, report } = build();
    expect(report.missing.species).toEqual(['fakemon', 'unownf']); // Unown-F is a letter, not a female forme
    expect(report.missing.moves).toEqual(['nomove']);
    expect(report.missing.items).toEqual(['berry']);
    expect(files['species.de.json']).not.toHaveProperty('unownf');
    expect(report.unusedOverrides.forms).toEqual([]);
    expect(build({ forms: { notaspecies: 'X' } }).report.unusedOverrides.forms).toEqual(['notaspecies']);
  });

  it('(f) skips empty ids (the ??? type and empty species ids)', () => {
    const { files } = build();
    expect(Object.keys(files['misc.de.json'].types)).not.toContain('');
    expect(Object.keys(files['species.de.json'])).not.toContain('');
  });

  it('exports the same toID fold as src/lib/pkmn/i18n/id.ts', () => {
    expect(toID('Flabébé')).toBe('flabebe');
    expect(toID('Nidoran♀')).toBe('nidoranf');
    expect(toID('Farfetch’d')).toBe('farfetchd');
  });
});
