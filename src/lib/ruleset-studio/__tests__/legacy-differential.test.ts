import { describe, expect, it } from 'vitest';
import { legacyFormToDocument } from '@/lib/ruleset-kit/legacy';
import { computeEffective } from '@/lib/ruleset-kit/effective';
import { validateRulesetDocument } from '@/lib/ruleset-kit/validate';
import { validateTeam } from '@/lib/pkmn/validation';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { toRulesetFromRules } from './rules-view';
import { convertLegacyRow, isCustomLeagueRuleset, legacyRuleIssues, resolveEffective, resolveLeagueDefault, type LegacyRow } from './legacy-oracle';
import type { PokemonSet, StatSpread } from '@/types/team';

/**
 * The differential proof of "no behaviour change": for a corpus of legacy ruleset shapes and teams, the OLD validator
 * (names compared in lower case, kept verbatim in `legacy-oracle.ts`) and the NEW validator over the converted rules report
 * the same bans, clauses and unknown entities. The same corpus drives the old resolver against the pin replay.
 */

const EVS: StatSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IVS: StatSpread = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

function mon(species: string, overrides: Partial<PokemonSet> = {}): PokemonSet {
  return { name: '', species, gender: '', item: 'Leftovers', ability: 'Rough Skin', evs: EVS, ivs: IVS, nature: 'Jolly', level: 100, moves: ['Earthquake'], ...overrides };
}

let counter = 0;
function row(overrides: Partial<LegacyRow>): LegacyRow {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    name: `Ruleset ${counter}`,
    base_format: 'gen9ou',
    is_doubles: false,
    clauses: [],
    banned_pokemon: [],
    banned_moves: [],
    banned_items: [],
    banned_abilities: [],
    added_pokemon: [],
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
    created_at: `2026-01-${String(counter).padStart(2, '0')}T00:00:00Z`,
    ...overrides,
  };
}

/** The new view of a legacy row: the SQL conversion's rules (TypeScript twin) behind the `Ruleset` read model. */
function converted(legacy: LegacyRow) {
  return toRulesetFromRules(legacy, convertLegacyRow(legacy));
}

const CORPUS: LegacyRow[] = [
  row({ name: 'Gen 9 OU', clauses: ['Species Clause', 'Sleep Clause Mod'], banned_pokemon: ['Koraidon', 'Garchomp', 'Rotom-Wash'], banned_moves: ['Baton Pass', 'Last Respects'], banned_items: ["King's Rock", 'Leftovers'], banned_abilities: ['Moody', 'Rough Skin'] }),
  row({ name: 'Item clause', clauses: ['Species Clause', 'Item Clause'] }),
  row({ name: 'Punctuation', base_format: 'gen8ou', banned_pokemon: ['Mr. Mime', 'Type: Null'] }),
  row({ name: 'Old generation', base_format: 'gen4ou', banned_pokemon: ['Garchomp'], clauses: ['Species Clause'] }),
  row({ name: 'Point buy', base_format: 'gen9', clauses: ['Item Clause'] }),
  row({ name: '1v1', base_format: 'gen91v1', banned_pokemon: ['Garchomp'] }),
  row({ name: 'Added and banned', added_pokemon: ['Garchomp', 'Pikachu'], banned_pokemon: ['Garchomp'] }),
  row({ name: 'Blank', base_format: 'blank' }),
];

const TEAMS: PokemonSet[][] = [
  [mon('Garchomp'), mon('Pikachu', { ability: 'Static', item: 'Light Ball', moves: ['Thunderbolt', 'Last Respects'] })],
  [mon('Rotom-Wash', { ability: 'Levitate', item: "King's Rock", moves: ['Baton Pass', 'Hydro Pump'] }), mon('Rotom-Heat', { ability: 'Levitate' })],
  [mon('Koraidon', { ability: 'Orichalcum Pulse', item: 'Leftovers' }), mon('Garchomp', { ability: 'Moody' })],
  [mon('Pikachu', { ability: 'Static' }), mon('Mr. Mime', { ability: 'Soundproof' })],
  [mon('Nope'), mon('Pikachu', { moves: ['Notarealmove'], item: 'Mystery Box', ability: 'Nope' })],
];

describe('the converted rules enforce what the legacy rows enforced', () => {
  it.each(CORPUS.map((r) => [r.name, r] as const))('%s: same findings on every team of the corpus', (_name, legacy) => {
    const ruleset = converted(legacy);
    for (const team of TEAMS) {
      const oldIssues = legacyRuleIssues(team, legacy)
        .map((i) => `${i.pokemon_index ?? 'team'}:${i.code}`)
        .sort();
      const result = validateTeam(team, ruleset);
      const codes = [
        ...result.issues.map((i) => `${i.pokemon_index}:${i.code}`),
        ...(result.team_issue_details ?? []).filter((d) => d.code === 'species_clause' || d.code === 'item_clause').map((d) => `team:${d.code}`),
      ].filter((c) => !/:(ev_total|ev_stat_cap|min_moves|max_moves)$/.test(c));
      expect(codes.sort(), `${legacy.name}: ${team.map((m) => m.species).join(', ')}`).toEqual(oldIssues);
    }
  });

  it('a converted legacy document is a valid ruleset document that resolves to the same rules as the SQL twin', () => {
    for (const legacy of CORPUS) {
      const doc = legacyFormToDocument({
        name: legacy.name,
        base_format: legacy.base_format,
        is_doubles: legacy.is_doubles,
        clauses: legacy.clauses,
        banned_pokemon: legacy.banned_pokemon,
        banned_moves: legacy.banned_moves,
        banned_items: legacy.banned_items,
        banned_abilities: legacy.banned_abilities,
        added_pokemon: legacy.added_pokemon,
        custom_rules_string: legacy.custom_rules_string,
        min_shared_type_pct: legacy.min_shared_type_pct,
        team_constraints: null,
      });
      const parsed = validateRulesetDocument(doc);
      expect(parsed.ok, legacy.name).toBe(true);
      const effective = computeEffective(doc, null);
      const twin = convertLegacyRow(legacy) as { pokemon: unknown; moves: unknown; items: unknown; abilities: unknown; clauses: unknown; gen: unknown; added_pokemon: unknown; format_key: unknown };
      // The bridge keeps the format only in `based_on`, so the format key can differ for 'blank'; everything enforced is equal.
      expect({ gen: effective.gen, clauses: effective.clauses, pokemon: effective.pokemon, moves: effective.moves, items: effective.items, abilities: effective.abilities, added: effective.added_pokemon }).toEqual({
        gen: twin.gen, clauses: twin.clauses, pokemon: twin.pokemon, moves: twin.moves, items: twin.items, abilities: twin.abilities, added: twin.added_pokemon,
      });
    }
  });

  it('an entry that never matched the old exact-name compare matches after the fold (reported by the pre-flight, accepted)', () => {
    // 'Mr Mime' was never equal to the dex name 'Mr. Mime'; its id (mrmime) is. This is the one deliberate difference.
    const legacy = row({ base_format: 'gen8ou', banned_pokemon: ['Mr Mime'] });
    const team = [mon('Mr. Mime', { ability: 'Soundproof' })];
    expect(legacyRuleIssues(team, legacy).map((i) => i.code)).not.toContain('species_banned');
    expect(validateTeam(team, converted(legacy)).issues.map((i) => i.code)).toContain('species_banned');

    // The dex spells Farfetch'd with a typographic apostrophe; a list written with the keyboard apostrophe never matched.
    const farfetchd = row({ base_format: 'gen8ou', banned_pokemon: ["Farfetch'd"] });
    const swordTeam = [mon("Farfetch'd", { ability: 'Keen Eye' })];
    expect(legacyRuleIssues(swordTeam, farfetchd).map((i) => i.code)).not.toContain('species_banned');
    expect(validateTeam(swordTeam, converted(farfetchd)).issues.map((i) => i.code)).toContain('species_banned');
  });
});

describe('the old resolver (oracle) on the shapes the migration replays', () => {
  const plain = row({ name: 'Gen 9 RU', base_format: 'gen9ru' });
  const custom = row({ name: 'Core Liga', base_format: 'gen9ru', team_constraints: { tera_match: 'player_core' } });
  const emptyObject = row({ name: 'Empty constraints', team_constraints: {} });
  const newline = row({ name: 'Newline rules', custom_rules_string: '\n' });
  const nbsp = row({ name: 'Nbsp rules', custom_rules_string: '  　' });
  const named = row({ name: 'Spring League', custom_rules_string: 'old rules', created_at: '2026-02-01T00:00:00Z' });
  const namedNewer = row({ name: 'Spring League', custom_rules_string: 'new rules', created_at: '2026-03-01T00:00:00Z' });
  const rows = [plain, custom, emptyObject, newline, nbsp, named, namedNewer];

  it('custom means constraints set (even {}), non-blank custom rules by JavaScript trim, or added Pokémon', () => {
    expect([plain, custom, emptyObject, newline, nbsp, named].map(isCustomLeagueRuleset)).toEqual([false, true, true, false, false, true]);
    expect(isCustomLeagueRuleset(row({ added_pokemon: ['Pikachu'] }))).toBe(true);
  });

  it('a phase keeps its own custom ruleset, else takes the league\'s custom one, else the oldest custom ruleset named like the league (group phases only)', () => {
    const season = { name: 'Spring League', ruleset_id: plain.id };
    expect(resolveEffective({ ruleset_id: custom.id, bracket_type: 'round_robin' }, season, rows)).toBe(custom.id);
    expect(resolveEffective({ ruleset_id: plain.id, bracket_type: 'round_robin' }, { name: 'Core', ruleset_id: custom.id }, rows)).toBe(custom.id);
    expect(resolveEffective({ ruleset_id: plain.id, bracket_type: 'round_robin' }, season, rows)).toBe(named.id);
    for (const playoff of ['single_elim', 'double_elim', 'swiss']) {
      expect(resolveEffective({ ruleset_id: plain.id, bracket_type: playoff }, season, rows)).toBe(plain.id);
    }
    expect(resolveEffective({ ruleset_id: plain.id, bracket_type: 'round_robin' }, null, rows)).toBe(plain.id);
  });

  it('the league default follows the same rule for a group-phase pseudo-phase', () => {
    expect(resolveLeagueDefault({ name: 'Spring League', ruleset_id: plain.id }, rows)).toBe(named.id);
    expect(resolveLeagueDefault({ name: 'Elsewhere', ruleset_id: plain.id }, rows)).toBe(plain.id);
    expect(resolveLeagueDefault({ name: 'Core Liga', ruleset_id: custom.id }, rows)).toBe(custom.id);
    expect(resolveLeagueDefault({ name: 'No ruleset', ruleset_id: null }, rows)).toBeNull();
  });
});

// The fixture helper is part of the contract the other tests rely on.
describe('makeRuleset', () => {
  it('derives rules from names', () => {
    expect(makeRuleset({ bans: { pokemon: ['Garchomp'], moves: [], items: [], abilities: [] } }).rules.pokemon.ids).toEqual(['garchomp']);
  });
});
