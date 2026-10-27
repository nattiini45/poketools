import { describe, expect, it } from 'vitest';
import { describeRuleset, describeTeamRules } from '../describe';
import { rulesFromBans } from '../effective';

const section = (rules: ReturnType<typeof describeRuleset>, id: string) => rules.sections.find((s) => s.id === id);

describe('describeRuleset', () => {
  const rules = rulesFromBans({
    gen: 9,
    formatKey: 'gen9ou',
    clauses: ['Species Clause', 'Sleep Clause Mod'],
    bans: { pokemon: ['koraidon', 'miraidon'], moves: ['lastrespects'], abilities: [] },
    minSharedTypePct: 50,
    customRules: 'No Tera Blast in the finals.',
  });

  it('writes every section in English, with plurals', () => {
    const text = describeRuleset(rules, 'en', { presetName: 'Gen 9 OU', nameOf: (_c, id) => id.toUpperCase() });
    expect(text.sections.map((s) => s.id)).toEqual(['base', 'clauses', 'pokemon', 'moves', 'items', 'abilities', 'constraints', 'notes']);
    expect(section(text, 'base')?.lines).toEqual([
      'Starts from the rule preset Gen 9 OU.',
      'Generation 9, singles.',
      'Pokémon, moves, items and abilities of the generation itself are legal.',
    ]);
    expect(section(text, 'pokemon')?.lines).toEqual(['2 Pokémon are banned: KORAIDON, MIRAIDON.']);
    expect(section(text, 'moves')?.lines).toEqual(['1 move is banned: LASTRESPECTS.']);
    expect(section(text, 'items')?.lines).toEqual(['No items are banned.']);
    expect(section(text, 'constraints')?.lines).toEqual(['At least 50% of the team must share a type.']);
    expect(section(text, 'notes')?.lines).toEqual(['No Tera Blast in the finals.']);
    expect(text.coverage).toBe('3 bans, 2 clauses');
    expect(text.entryCount).toBe(3);
  });

  it('is honest about the clauses the validator does not check', () => {
    const text = describeRuleset(rules, 'en', { presetName: null });
    expect(section(text, 'clauses')?.lines[0]).toBe('Clauses: Sleep Clause Mod, Species Clause.');
    expect(section(text, 'clauses')?.lines[1]).toContain('only the Species Clause and the Item Clause');
    const only = describeRuleset(rulesFromBans({ gen: 9, clauses: ['Species Clause'] }), 'en', { presetName: null });
    expect(section(only, 'clauses')?.lines).toHaveLength(1);
    expect(section(describeRuleset(rulesFromBans({ gen: 9 }), 'en', { presetName: null }), 'clauses')?.lines).toEqual(['No clauses apply.']);
  });

  it('writes the same text in German', () => {
    const text = describeRuleset(rules, 'de', { presetName: 'Gen 9 OU' });
    expect(section(text, 'base')?.lines[0]).toBe('Startet vom Regel-Preset Gen 9 OU.');
    expect(section(text, 'pokemon')?.lines[0]).toBe('2 Pokémon sind gebannt: koraidon, miraidon.');
    expect(section(text, 'moves')?.lines[0]).toBe('1 Attacke ist gebannt: lastrespects.');
    expect(section(text, 'constraints')?.lines[0]).toBe('Mindestens 50 % des Teams müssen einen Typ teilen.');
    expect(text.coverage).toBe('3 Bans, 2 Klauseln');
  });

  it('spells out an allowlist and cuts a long list with "and N more"', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `mon${String(i).padStart(2, '0')}`);
    const allow = rulesFromBans({ gen: 9, allow: { pokemon: ids } });
    const text = describeRuleset(allow, 'en', { presetName: null, maxNames: 3 });
    expect(section(text, 'pokemon')?.lines[0]).toBe('Only these 20 Pokémon are legal: mon00, mon01, mon02, and 17 more.');
    const single = describeRuleset(rulesFromBans({ gen: 9, allow: { items: ['leftovers'] } }), 'en', { presetName: null });
    expect(section(single, 'items')?.lines[0]).toBe('Only 1 item is legal: leftovers.');
  });

  it('describes a National Dex doubles base and the team constraints', () => {
    const nat = rulesFromBans({
      gen: 9,
      doubles: true,
      universe: 'national',
      teamConstraints: {
        type_quotas: { source: 'fixed', fixed_types: ['Fire', 'Water'], min_per_type: 1, allow_multi_count: true },
        tera_match: 'player_core',
        evolution_stage: { mode: 'nfe_only_plus_n_fe', fully_evolved_cap: 2 },
        eviolite_tier_cap: 'NU',
      },
    });
    const text = describeRuleset(nat, 'en', { presetName: null });
    expect(section(text, 'base')?.lines.slice(1)).toEqual(['Generation 9, doubles.', 'The National Dex is legal: everything the generation dropped, too.']);
    expect(section(text, 'constraints')?.lines).toEqual([
      'Type quotas: at least 1 Pokémon of each of these types: Fire, Water.',
      'Tera types must match the player’s core types.',
      'Evolution stage: only Pokémon that are not fully evolved, plus up to 2 fully evolved.',
      'Eviolite is limited to Pokémon of tier NU or lower.',
    ]);
    const de = describeRuleset(nat, 'de', { presetName: null });
    expect(section(de, 'constraints')?.lines[0]).toBe('Typ-Quoten: mindestens 1 Pokémon von jedem dieser Typen: Feuer, Wasser.');
  });
});

describe('describeTeamRules', () => {
  it('is empty when the ruleset has no team rule, so a view can leave its heading out', () => {
    expect(describeTeamRules({ min_shared_type_pct: 0, team_constraints: null }, 'en')).toEqual([]);
  });

  it('writes the shared-type rule first, then each team constraint, in both languages', () => {
    const rules = {
      min_shared_type_pct: 50,
      team_constraints: { type_quotas: { source: 'fixed' as const, fixed_types: ['Fire'], min_per_type: 2, allow_multi_count: true }, tera_match: 'team_types' as const },
    };
    const en = describeTeamRules(rules, 'en');
    expect(en[0]).toBe('At least 50% of the team must share a type.');
    expect(en).toHaveLength(3);
    expect(describeTeamRules(rules, 'de')[0]).toBe('Mindestens 50 % des Teams müssen einen Typ teilen.');
  });

  it('a view that prints the shared-type rule itself passes 0 and gets only the constraints', () => {
    const lines = describeTeamRules({ min_shared_type_pct: 0, team_constraints: { tera_match: 'player_core' } }, 'en');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('share a type');
  });

  it('describeRuleset keeps its "no team rules" line on top of it', () => {
    const none = rulesFromBans({ gen: 9, formatKey: 'gen9ou' });
    expect(section(describeRuleset(none, 'en', { presetName: null }), 'constraints')?.lines).toHaveLength(1);
  });
});

