import { describe, it, expect, afterEach, vi } from 'vitest';

// Only `getRulesetById` is mocked; it's invoked solely when a `ruleset_id` is
// passed, so the unconstrained live tests below are unaffected.
vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(async () => null),
}));

import { buildTeam } from '../team-builder';
import { validateTeam } from '../validate';
import { __clearSmogonToolCache } from '../smogon';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import type { Ruleset } from '@/types/ruleset';

function makeRuleset(overrides: Partial<Ruleset>): Ruleset {
  return {
    id: 'rs-test', name: 'Test League', base_format: 'gen9ou', is_doubles: false,
    clauses: ['Species Clause'],
    bans: { pokemon: [], moves: [], items: [], abilities: [] },
    additions: { pokemon: [] }, custom_rules_string: '', min_shared_type_pct: 0,
    team_constraints: null,
    created_by: null, created_at: '', updated_at: '',
    ...overrides,
  };
}

// buildTeam hits the live https://data.pkmn.cc usage dataset (generous timeout),
// but pokepaste publishing is mocked so we don't POST to the real service. We
// stub global.fetch to intercept ONLY pokepast.es calls and pass everything
// else through to the real fetch (so live usage stats still load).

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __clearSmogonToolCache();
});

function mockPokepasteOnly() {
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('pokepast.es')) {
        return new Response(null, { status: 303, headers: { location: '/mockpaste0001' } });
      }
      return realFetch(input as never, init);
    }),
  );
}

describe('buildTeam (live usage, mocked pokepaste)', () => {
  it('builds a legal 6-mon gen9ou team that includes the requested core', async () => {
    mockPokepasteOnly();

    const result = await buildTeam({ format: 'gen9ou', core_pokemon: ['Garchomp'], team_size: 6 });

    // Six mons, including Garchomp.
    expect(result.team).toHaveLength(6);
    expect(result.team.map((s) => s.species)).toContain('Garchomp');

    // No duplicate base species (Species Clause respected).
    const baseNames = result.team.map((s) => s.species.toLowerCase());
    expect(new Set(baseNames).size).toBe(6);

    // Every set has 1–4 moves and an ability.
    for (const set of result.team) {
      expect(set.moves.length).toBeGreaterThanOrEqual(1);
      expect(set.moves.length).toBeLessThanOrEqual(4);
      expect(typeof set.ability).toBe('string');
    }

    // The reported team is legality-clean.
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);

    // Independently re-validate to be sure.
    const recheck = await validateTeam({
      format: 'gen9ou',
      team: result.team.map((s) => ({
        species: s.species,
        item: s.item || undefined,
        ability: s.ability || undefined,
        nature: s.nature,
        evs: s.evs,
        moves: s.moves,
        teraType: s.teraType,
      })),
    });
    expect(recheck.valid).toBe(true);

    // Paste text + mocked pokepaste URL.
    expect(result.paste).toContain('Garchomp');
    expect(result.pasteUrl).toBe('https://pokepast.es/mockpaste0001');

    // Coverage shape.
    expect(Array.isArray(result.coverage.weakTo)).toBe(true);
    expect(Array.isArray(result.coverage.resistedBy)).toBe(true);
  }, 60000);

  it('honors requested_moves overrides for a core', async () => {
    mockPokepasteOnly();

    const result = await buildTeam({
      format: 'gen9ou',
      core_pokemon: ['Garchomp'],
      requested_moves: { Garchomp: ['Earthquake', 'Stealth Rock'] },
      team_size: 6,
    });

    const chomp = result.team.find((s) => s.species === 'Garchomp');
    expect(chomp).toBeDefined();
    expect(chomp!.moves).toContain('Earthquake');
    expect(chomp!.moves).toContain('Stealth Rock');
    expect(result.valid).toBe(true);
  }, 60000);

  it('respects a league ruleset: skips a banned core and never places it', async () => {
    mockPokepasteOnly();
    vi.mocked(getRulesetById).mockResolvedValue(
      makeRuleset({ id: 'rs-ban', name: 'No Kingambit League', bans: { pokemon: ['Kingambit'], moves: [], items: [], abilities: [] } }),
    );

    const result = await buildTeam({
      format: 'gen9ou', ruleset_id: 'rs-ban', core_pokemon: ['Kingambit'], team_size: 6,
    });

    // The banned core is dropped (with a note) and never appears in the team.
    expect(result.notes.some((n) => /banned/i.test(n))).toBe(true);
    expect(result.team.map((s) => s.species)).not.toContain('Kingambit');
    expect(result.valid).toBe(true);
  }, 60000);

  it('never places a banned move or item, even when requested', async () => {
    mockPokepasteOnly();
    vi.mocked(getRulesetById).mockResolvedValue(
      makeRuleset({
        id: 'rs-ban2',
        bans: { pokemon: [], moves: ['Stealth Rock'], items: ['Leftovers'], abilities: [] },
      }),
    );

    const result = await buildTeam({
      format: 'gen9ou', ruleset_id: 'rs-ban2',
      core_pokemon: ['Garchomp'],
      requested_moves: { Garchomp: ['Earthquake', 'Stealth Rock'] },
      requested_items: { Garchomp: 'Leftovers' },
      team_size: 6,
    });

    // The banned move/item are stripped even though they were explicitly requested.
    expect(result.team.every((s) => !s.moves.some((m) => /stealth rock/i.test(m)))).toBe(true);
    expect(result.team.every((s) => s.item.toLowerCase() !== 'leftovers')).toBe(true);
    expect(result.valid).toBe(true);
  }, 60000);

  it('satisfies a player-core type quota from the league ruleset', async () => {
    mockPokepasteOnly();
    vi.mocked(getRulesetById).mockResolvedValue(
      makeRuleset({
        id: 'rs-core', name: 'Sample Custom League',
        team_constraints: {
          type_quotas: { source: 'player_core', min_per_type: 1, allow_multi_count: true },
        },
      }),
    );

    const result = await buildTeam({
      format: 'gen9ou', ruleset_id: 'rs-core', player_core: ['Fire', 'Water', 'Grass'], team_size: 6,
    });

    expect(result.team).toHaveLength(6);
    // No outstanding type-quota complaint, and the team validates clean.
    expect(result.team_issues.some((m) => /Type quota/i.test(m))).toBe(false);
    expect(result.valid).toBe(true);
  }, 60000);
});
