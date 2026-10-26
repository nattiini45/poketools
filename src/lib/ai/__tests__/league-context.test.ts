import { describe, it, expect } from 'vitest';
import { renderAllowlists, renderTeamConstraints, renderCoreAssignments } from '../league-context';
import type { TeamConstraints } from '@/types/ruleset';
import type { CoreTriple } from '@/types/season';

describe('renderAllowlists', () => {
  const NONE = { pokemon: null, moves: null, items: null, abilities: null };

  it('prints nothing for a ruleset without an allowlist', () => {
    expect(renderAllowlists(NONE)).toEqual([]);
  });

  it('prints one line per list in allowlist mode, so the model cannot take the other entries for legal', () => {
    const lines = renderAllowlists({ ...NONE, pokemon: ['Pikachu', 'Raichu'], abilities: ['Static'] });
    expect(lines).toEqual([
      'Allowlist: ONLY these Pokémon are legal (2): Pikachu, Raichu',
      'Allowlist: ONLY these abilities are legal (1): Static',
    ]);
  });

  it('cuts a long list and counts the rest; an empty allowlist says that nothing is legal', () => {
    const names = Array.from({ length: 35 }, (_, i) => `Mon${i}`);
    expect(renderAllowlists({ ...NONE, pokemon: names })[0]).toContain('(+5 more)');
    expect(renderAllowlists({ ...NONE, items: [] })).toEqual(['Allowlist: ONLY these items are legal (0): none']);
  });
});

describe('renderTeamConstraints', () => {
  it('returns [] for null/empty constraints', () => {
    expect(renderTeamConstraints(null)).toEqual([]);
    expect(renderTeamConstraints(undefined)).toEqual([]);
    expect(renderTeamConstraints({})).toEqual([]);
  });

  it('describes a player-core type quota with multi-count', () => {
    const c: TeamConstraints = {
      type_quotas: { source: 'player_core', min_per_type: 2, allow_multi_count: true },
    };
    const lines = renderTeamConstraints(c);
    expect(lines.join('\n')).toContain('Type quota');
    expect(lines.join('\n')).toContain('core types');
    expect(lines.join('\n')).toContain('counts toward each of its types');
  });

  it('describes a fixed-type quota and lists the types', () => {
    const c: TeamConstraints = {
      type_quotas: { source: 'fixed', fixed_types: ['Bug'], min_per_type: 3, allow_multi_count: false },
    };
    const out = renderTeamConstraints(c).join('\n');
    expect(out).toContain('Bug');
    expect(out).toContain('only a Pokémon\'s primary type counts');
  });

  it('describes tera, evolution and eviolite rules', () => {
    const c: TeamConstraints = {
      tera_match: 'player_core',
      evolution_stage: { mode: 'nfe_only_plus_n_fe', fully_evolved_cap: 1, fully_evolved_tier_max: 'RU', legendaries_allowed: false },
      eviolite_tier_cap: 'NU',
    };
    const out = renderTeamConstraints(c).join('\n');
    expect(out).toContain('Tera');
    expect(out).toContain('assigned core types');
    expect(out).toContain('not-fully-evolved');
    expect(out).toContain('no legendaries');
    expect(out).toContain('Eviolite');
  });
});

describe('renderCoreAssignments', () => {
  it('returns [] when no entry has a core', () => {
    expect(renderCoreAssignments([{ name: 'Alice', core: null }])).toEqual([]);
    expect(renderCoreAssignments([])).toEqual([]);
  });

  it('renders only entries with a valid 3-type core and marks self', () => {
    const core: CoreTriple = ['Fire', 'Grass', 'Water'];
    const lines = renderCoreAssignments([
      { name: 'Alice', core, isSelf: true },
      { name: 'Bob', core: null },
    ]);
    const out = lines.join('\n');
    expect(out).toContain('Assigned Core Types');
    expect(out).toContain('Alice (you): Fire / Grass / Water');
    expect(out).not.toContain('Bob');
  });
});
