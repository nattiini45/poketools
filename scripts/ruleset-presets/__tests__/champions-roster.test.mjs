// Tests for scripts/ruleset-presets/champions-roster.mjs: the pure derivation of the Champions roster from Showdown's
// data tables. Small hand-made tables in the shape of the Showdown source; no network, no downloaded file.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveChampionsRoster, emitRosterModule, mergeTable, parseDataTable, toID } from '../champions-roster.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('parseDataTable', () => {
  it('reads the literal object of an export const, never evaluating code', () => {
    const source = `
      export const Items: import('../sim/dex-items').ItemDataTable = {
        leftovers: { name: "Leftovers", num: 234, isNonstandard: null, onResidual(pokemon) { evil(); } },
        // a comment
        absolite: { name: 'Absolite', megaStone: { Absol: 'Absol-Mega' }, isNonstandard: "Past" },
        shed: { inherit: true, tier: -3, list: ['a', 'b'], flag: true },
      };
    `;
    const items = parseDataTable(source, 'Items');
    expect(items.leftovers).toEqual({ name: 'Leftovers', num: 234, isNonstandard: null, onResidual: '<code>' });
    expect(items.absolite).toEqual({ name: 'Absolite', megaStone: { Absol: 'Absol-Mega' }, isNonstandard: 'Past' });
    expect(items.shed).toEqual({ inherit: true, tier: -3, list: ['a', 'b'], flag: true });
    expect(parseDataTable(source, 'Moves')).toBeNull();
  });
});

describe('mergeTable', () => {
  it('follows the sim rule: missing entries come from the parent, a child entry replaces, inherit merges, null deletes', () => {
    const parent = { a: { n: 1, keep: true }, b: { n: 2 }, c: { n: 3 }, d: { n: 4 } };
    const child = { a: { n: 10 }, b: { inherit: true, extra: 1 }, c: null };
    expect(mergeTable(parent, child)).toEqual({ a: { n: 10 }, b: { n: 2, extra: 1 }, d: { n: 4 } });
    expect(mergeTable(parent, null)).toBe(parent);
  });
});

describe('deriveChampionsRoster', () => {
  const base = {
    Pokedex: {
      venusaur: { name: 'Venusaur', baseSpecies: 'Venusaur', forme: '', abilities: { 0: 'Overgrow', H: 'Chlorophyll' } },
      venusaurmega: { name: 'Venusaur-Mega', baseSpecies: 'Venusaur', forme: 'Mega', battleOnly: 'Venusaur', abilities: { 0: 'Thick Fat' } },
      mewtwo: { name: 'Mewtwo', baseSpecies: 'Mewtwo', forme: '', abilities: { 0: 'Pressure' } },
      pikachu: { name: 'Pikachu', baseSpecies: 'Pikachu', forme: '', abilities: { 0: 'Static' } },
      pikachucosplay: { name: 'Pikachu-Cosplay', baseSpecies: 'Pikachu', forme: 'Cosplay', isCosmeticForme: true, abilities: { 0: 'Static' } },
      gyarados: { name: 'Gyarados', baseSpecies: 'Gyarados', forme: '', abilities: { 0: 'Intimidate' } },
      gyaradosmega: { name: 'Gyarados-Mega', baseSpecies: 'Gyarados', forme: 'Mega', battleOnly: 'Gyarados', abilities: { 0: 'Mold Breaker' } },
      castform: { name: 'Castform', baseSpecies: 'Castform', forme: '', abilities: { 0: 'Forecast' } },
      castformrainy: { name: 'Castform-Rainy', baseSpecies: 'Castform', forme: 'Rainy', battleOnly: 'Castform', abilities: { 0: 'Forecast' } },
    },
    FormatsData: {
      venusaur: { tier: 'OU' },
      venusaurmega: { tier: 'UU' },
      mewtwo: { isNonstandard: 'Past', tier: 'Illegal' },
      pikachu: { tier: 'NU' },
      pikachucosplay: { tier: 'NU' },
      gyarados: { isNonstandard: 'Past', tier: 'Illegal' },
      gyaradosmega: { tier: 'UU' },
      castform: { tier: 'PU' },
      castformrainy: { tier: 'PU' },
    },
    Items: {
      leftovers: { name: 'Leftovers' },
      venusaurite: { name: 'Venusaurite', megaStone: 'Venusaur-Mega' },
      choiceband: { name: 'Choice Band' },
    },
    Abilities: {},
    Moves: {
      earthquake: { name: 'Earthquake' },
      terablast: { name: 'Tera Blast' },
      hiddenpower: { name: 'Hidden Power' },
      swordsdance: { name: 'Swords Dance' },
    },
    Learnsets: {
      venusaur: { learnset: { earthquake: ['9M'], terablast: ['9M'], hiddenpower: ['9M'] } },
      pikachu: { learnset: { swordsdance: ['9M'] } },
    },
  };
  const mod = {
    FormatsData: {
      // Gyarados is back; its Mega is not listed by the mod, so the base entry stays (UU, standard).
      venusaur: { tier: 'OU' },
      venusaurmega: { tier: 'UU' },
      mewtwo: { isNonstandard: 'Past', tier: 'Illegal' },
      pikachu: { tier: 'NU' },
      pikachucosplay: { tier: 'NU' },
      gyarados: { tier: 'OU' },
      gyaradosmega: { isNonstandard: 'Past', tier: 'Illegal' },
      castform: { tier: 'PU' },
      castformrainy: { tier: 'PU' },
    },
    Items: { choiceband: { inherit: true, isNonstandard: 'Past' }, venusaurite: { inherit: true, isNonstandard: null } },
    Abilities: {},
    Moves: { terablast: { inherit: true, isNonstandard: 'Past' }, hiddenpower: { inherit: true, isNonstandard: 'Past' } },
    // The mod's own entries: Gyarados has none, so it has no move list (learnsets do not follow prevolutions or the base).
    Learnsets: { venusaur: { learnset: { earthquake: ['9M'], terablast: ['9M'], hiddenpower: ['9M'] } }, pikachu: { learnset: { swordsdance: ['9M'] } } },
  };

  const roster = deriveChampionsRoster({ base, mod });

  it('keeps the species whose merged data is not non-standard, in their groups', () => {
    expect(roster.species.selectable).toEqual(['castform', 'gyarados', 'pikachu', 'venusaur']);
    expect(roster.species.mega).toEqual(['venusaurmega']);
    expect(roster.species.battleOnly).toEqual(['castformrainy']);
    expect(roster.species.cosmetic).toEqual(['pikachucosplay']);
  });

  it('drops a Mega whose own entry the mod marks as past, and a species the mod marks as past', () => {
    expect(roster.species.mega).not.toContain('gyaradosmega');
    expect(roster.species.selectable).not.toContain('mewtwo');
  });

  it('needs the parent forme of a Mega or battle-only forme to be legal too', () => {
    const noParent = deriveChampionsRoster({
      base,
      mod: { ...mod, FormatsData: { ...mod.FormatsData, venusaur: { isNonstandard: 'Past', tier: 'Illegal' } } },
    });
    expect(noParent.species.selectable).not.toContain('venusaur');
    expect(noParent.species.mega).toEqual([]);
  });

  it('lists the items the merged table leaves standard', () => {
    expect(roster.items).toEqual(['leftovers', 'venusaurite']);
  });

  it('splits the abilities into the ones a selectable species has and the Mega-only ones', () => {
    expect(roster.abilities).toEqual(['chlorophyll', 'forecast', 'intimidate', 'overgrow', 'static']);
    expect(roster.megaAbilities).toEqual(['thickfat']);
  });

  it('takes the moves from the learnsets of roster species, less the moves the merged table marks as past', () => {
    expect(roster.moves).toEqual(['earthquake', 'swordsdance']);
  });

  it('is deterministic and sorted', () => {
    expect(deriveChampionsRoster({ base, mod })).toEqual(roster);
    for (const list of [roster.items, roster.abilities, roster.moves, ...Object.values(roster.species)]) {
      expect(list).toEqual([...list].sort());
    }
  });
});

describe('toID', () => {
  it('folds a Showdown name, including the typographic apostrophe of the source', () => {
    expect(toID('Farfetch’d')).toBe('farfetchd');
    expect(toID('Mr. Mime')).toBe('mrmime');
    expect(toID('Charizard-Mega-X')).toBe('charizardmegax');
  });
});

describe('the committed roster module', () => {
  const text = readFileSync(join(ROOT, 'src/lib/pkmn/preset-data/champions-roster.generated.ts'), 'utf8');

  function ids(name) {
    const start = text.indexOf(`export const ${name}`);
    const open = text.indexOf('= [', start);
    const close = text.indexOf('\n];', open);
    return [...text.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }

  it('is what emitRosterModule writes for its own lists: header counts, pin and arrays round-trip', () => {
    const roster = {
      species: {
        selectable: ids('CHAMPIONS_SPECIES_SELECTABLE'),
        mega: ids('CHAMPIONS_SPECIES_MEGA'),
        battleOnly: ids('CHAMPIONS_SPECIES_BATTLE_ONLY'),
        cosmetic: ids('CHAMPIONS_SPECIES_COSMETIC'),
      },
      items: ids('CHAMPIONS_ITEMS'),
      abilities: ids('CHAMPIONS_ABILITIES'),
      megaAbilities: ids('CHAMPIONS_MEGA_ABILITIES'),
      moves: ids('CHAMPIONS_MOVES'),
    };
    const sha = /sha: '([0-9a-f]{40})'/.exec(text)?.[1];
    const date = /date: '(\d{4}-\d{2}-\d{2})'/.exec(text)?.[1];
    expect(sha).toBeDefined();
    expect(emitRosterModule(roster, { sha, date, mod: 'champions', regulation: 'M-C' }) + '\n').toBe(text);
  });
});
