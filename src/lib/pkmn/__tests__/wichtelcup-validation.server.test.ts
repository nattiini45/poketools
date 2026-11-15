import { describe, expect, it } from 'vitest';
import { Dex } from '@pkmn/dex';
import { computeEffective } from '@/lib/ruleset-kit/effective';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';
import { toID } from '../i18n/id';
import { resolvePresetRules } from '../preset-rules.server';
import { validateTeam } from '../validation';

// The Wichtelcup EXAMPLE preset through the team validator, with the real dex and the made-up pools: the allowlist admits
// the pool's base species, the bans close the Mega stones and Z-crystals that would open a forme, and the Species Clause
// counts two sets of one species. The real tournament's forme tuning lives in the private pack.

const preset = resolvePresetRules('gen9natdexwichtelcup');
if (preset === null) throw new Error('the Wichtelcup preset is missing');
const resolved = computeEffective(newRulesetDocument('Wichtelcup', 'en', 'gen9natdexwichtelcup'), preset);
const ruleset = makeRuleset({ base_format: 'gen9natdexwichtelcup', universe: 'national', rules: resolved });

const codes = (team: ReturnType<typeof makeSet>[]): string[] => {
  const result = validateTeam(team, ruleset);
  return [...result.issues.map((issue) => issue.code ?? ''), ...(result.team_issue_details ?? []).map((issue) => issue.code ?? '')];
};
const noMoves = { moves: ['Protect'], item: '', ability: '' };

describe('validateTeam on the Wichtelcup example ruleset', () => {
  it('accepts pool species in their listed form', () => {
    const team = ['Pikachu', 'Starmie', 'Dragonite', 'Snorlax', 'Gengar', 'Mewtwo'].map((species) => makeSet(species, noMoves));
    expect(validateTeam(team, ruleset).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('rejects species outside the pool and unlisted formes of pool species', () => {
    expect(codes([makeSet('Arceus', noMoves)])).toContain('species_not_allowed');
    expect(codes([makeSet('Rayquaza', noMoves)])).toContain('species_not_allowed');
    expect(codes([makeSet('Charizard-Mega-X', noMoves)])).toContain('species_not_allowed');
  });

  it('counts two sets of one species against the Species Clause', () => {
    expect(codes([makeSet('Pikachu', noMoves), makeSet('Pikachu', noMoves)])).toContain('species_clause');
  });

  it('keeps a pool species in base form: its Mega is closed and the stone banned', () => {
    expect(codes([makeSet('Charizard-Mega-X', noMoves)])).toContain('species_not_allowed');
    expect(codes([makeSet('Charizard', { ...noMoves, item: 'Charizardite X' })])).toContain('item_banned');
    expect(resolved.clauses).toContain('megarayquazaclause');
    expect(resolved.moves).toEqual({ mode: 'block', ids: [] });
  });

  it('bans the Mega stones and Z-crystals that would open a forme', () => {
    expect(codes([makeSet('Mewtwo', { ...noMoves, item: 'Mewtwonite X' })])).toContain('item_banned');
    expect(codes([makeSet('Dragonite', { ...noMoves, item: 'Normalium Z' })])).toContain('item_banned');
    expect(codes([makeSet('Gengar', { ...noMoves, item: 'Ultranecrozium Z' })])).toContain('item_banned');
  });

  it('bans the example abilities and Light Clay', () => {
    expect(codes([makeSet('Ninetales', { ...noMoves, ability: 'Snow Cloak' })])).toContain('ability_banned');
    expect(codes([makeSet('Alakazam', { ...noMoves, ability: 'Moody' })])).toContain('ability_banned');
    expect(codes([makeSet('Pikachu', { ...noMoves, item: 'Light Clay' })])).toContain('item_banned');
  });
});

describe('every forme a Wichtelcup example species can turn into is closed', () => {
  const dex = Dex.forGen(9);
  const allowed = new Set(resolved.pokemon.ids);
  const bannedItems = new Set(resolved.items.ids);
  const clauses = new Set(resolved.clauses);

  it('a forme outside the pool that needs an item has that item banned, and a Mega that needs a move has its clause', () => {
    const open: string[] = [];
    for (const id of allowed) {
      const species = dex.species.get(id);
      if (!species.exists || species.baseSpecies !== species.name) continue;
      for (const formeName of species.otherFormes ?? []) {
        const forme = dex.species.get(formeName);
        if (allowed.has(forme.id)) continue;
        const items = (forme.requiredItems ?? (forme.requiredItem ? [forme.requiredItem] : [])).map(toID);
        // "No Mega Evolution": a Mega forme that needs a move instead of a stone is closed by the Mega Rayquaza Clause and
        // by the allowlist, not by banning the move. Other in-battle changes are ordinary play and not the example's business.
        const megaMove = forme.isMega && forme.requiredMove !== undefined;
        if (items.length > 0 && !items.every((item) => bannedItems.has(item))) open.push(`${forme.name}: item`);
        if (megaMove && !clauses.has('megarayquazaclause')) open.push(`${forme.name}: clause`);
      }
    }
    expect(open).toEqual([]);
  });
});