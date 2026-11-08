import { describe, expect, it } from 'vitest';
import { Dex } from '@pkmn/dex';
import { computeEffective } from '@/lib/ruleset-kit/effective';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';
import { toID } from '../i18n/id';
import { resolvePresetRules } from '../preset-rules.server';
import { validateTeam } from '../validation';

// The Wichtelcup preset through the team validator, with the real dex: the cup allows "base form" entries, so a forme
// that an item or a move forces mid-team-building must be closed by the bans, not only by the allowlist.

const preset = resolvePresetRules('gen9natdexwichtelcup');
if (preset === null) throw new Error('the Wichtelcup preset is missing');
const resolved = computeEffective(newRulesetDocument('Wichtelcup', 'en', 'gen9natdexwichtelcup'), preset);
const ruleset = makeRuleset({ base_format: 'gen9natdexwichtelcup', universe: 'national', rules: resolved });

const codes = (team: ReturnType<typeof makeSet>[]): string[] => {
  const result = validateTeam(team, ruleset);
  return [...result.issues.map((issue) => issue.code ?? ''), ...(result.team_issue_details ?? []).map((issue) => issue.code ?? '')];
};
const noMoves = { moves: ['Protect'], item: '', ability: '' };

describe('validateTeam on the Wichtelcup ruleset', () => {
  it('accepts pool species in their listed form', () => {
    const team = ['Abomasnow', 'Lapras', 'Jirachi', 'Rotom-Frost', 'Vivillon-Icy-Snow', 'Sandslash-Alola'].map((species) => makeSet(species, noMoves));
    expect(validateTeam(team, ruleset).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('rejects species outside the pool and unlisted formes of pool species', () => {
    expect(codes([makeSet('Garchomp', noMoves)])).toContain('species_not_allowed');
    expect(codes([makeSet('Rayquaza-Mega', noMoves)])).toContain('species_not_allowed');
    expect(codes([makeSet('Vivillon', noMoves)])).toContain('species_not_allowed');
  });

  it('accepts both formes of Toxtricity, which count as one species', () => {
    // The rules text lists Toxtricity as the "standard species; use form details supported by engine and Species Clause".
    expect(codes([makeSet('Toxtricity', noMoves)])).not.toContain('species_not_allowed');
    expect(codes([makeSet('Toxtricity-Low-Key', noMoves)])).not.toContain('species_not_allowed');
    expect(codes([makeSet('Toxtricity', noMoves), makeSet('Toxtricity-Low-Key', noMoves)])).toContain('species_clause');
  });

  it('accepts a Rayquaza set with Dragon Ascent while Mega Rayquaza stays closed', () => {
    const withAscent = { ...noMoves, moves: ['Dragon Ascent'] };
    expect(codes([makeSet('Rayquaza', withAscent)])).toEqual([]);
    // "No Mega Evolution": the Mega forme is not in the allowlist, and the clause is part of the preset.
    expect(codes([makeSet('Rayquaza-Mega', withAscent)])).toContain('species_not_allowed');
    expect(resolved.clauses).toContain('megarayquazaclause');
    expect(resolved.moves.ids).not.toContain('dragonascent');
  });

  it('closes the routes to Primal Groudon, the Origin formes and Ultra Necrozma', () => {
    expect(codes([makeSet('Groudon', { ...noMoves, item: 'Red Orb' })])).toContain('item_banned');
    expect(codes([makeSet('Dialga', { ...noMoves, item: 'Adamant Crystal' })])).toContain('item_banned');
    expect(codes([makeSet('Palkia', { ...noMoves, item: 'Lustrous Globe' })])).toContain('item_banned');
    expect(codes([makeSet('Necrozma', { ...noMoves, item: 'Ultranecrozium Z' })])).toContain('item_banned');
  });

  it('counts alternate formes against the Species Clause', () => {
    expect(codes([makeSet('Rotom-Frost', noMoves), makeSet('Rotom-Heat', noMoves)])).toContain('species_clause');
  });

  it('bans the cup abilities and Light Clay', () => {
    expect(codes([makeSet('Abomasnow', { ...noMoves, ability: 'Snow Cloak' })])).toContain('ability_banned');
    expect(codes([makeSet('Abomasnow', { ...noMoves, item: 'Light Clay' })])).toContain('item_banned');
  });
});

describe('every forme a Wichtelcup species can turn into is closed', () => {
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
        // "No Mega Evolution": a Mega forme that needs a move instead of a stone (Rayquaza) is closed by the Mega Rayquaza Clause
        // and by the allowlist, not by banning the move (Dragon Ascent is legal). Other in-battle changes (Meloetta's Relic Song,
        // Castform's Forecast) are ordinary play and not the cup's business.
        const megaMove = forme.isMega && forme.requiredMove !== undefined;
        // A forme with a required item is reachable through any one of them: all must be banned.
        if (items.length > 0 && !items.every((item) => bannedItems.has(item))) open.push(`${forme.name}: item`);
        if (megaMove && !clauses.has('megarayquazaclause')) open.push(`${forme.name}: clause`);
      }
    }
    expect(open).toEqual([]);
  });
});
