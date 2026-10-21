import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Ruleset } from '@/types/ruleset';

// ── Supabase mock builder ─────────────────────────────────────────
const mockBuilder = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
    'limit', 'range', 'match', 'returns', 'throwOnError',
  ];
  for (const m of methods) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  // `then` makes the chain thenable so `await query` works.
  mb.then = vi.fn();
  return mb;
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

// ── Imports under test ────────────────────────────────────────────
import {
  isCustomLeagueRuleset,
  resolveEffectiveRuleset,
} from '../rulesets';

// ── Fixtures ──────────────────────────────────────────────────────

function makeRuleset(overrides: Partial<Ruleset>): Ruleset {
  return {
    id: overrides.id ?? 'rs-1',
    name: overrides.name ?? 'Standard Gen 9 RU',
    base_format: overrides.base_format ?? 'gen9ru',
    is_doubles: overrides.is_doubles ?? false,
    clauses: overrides.clauses ?? ['Species Clause'],
    bans: overrides.bans ?? { pokemon: [], moves: [], items: [], abilities: [] },
    additions: overrides.additions ?? { pokemon: [] },
    custom_rules_string: overrides.custom_rules_string ?? '',
    min_shared_type_pct: overrides.min_shared_type_pct ?? 0,
    team_constraints: overrides.team_constraints ?? null,
    created_by: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
  };
}

const BASE_GEN9RU = makeRuleset({
  id: 'c7b6a447-ccf5-48ea-b3fe-a97119444a7e',
  name: 'Gen 9 RU',
  base_format: 'gen9ru',
});

// Type Triangle League — actual production fixture shape:
// `type_quotas.source === 'player_core'` (DYNAMIC per participant's
// assigned core triple in season_participants.core_types), NFE phase,
// Eviolite cap, custom bans/items. NO fixed_types — the types come from
// each player's core assignment.
const TYPE_TRIANGLE_LEAGUE = makeRuleset({
  id: '6b78fb01-cc29-4b05-9fb6-125647b00058',
  name: 'Type Triangle League',
  base_format: 'gen9ru',
  clauses: [
    'Species Clause',
    'Sleep Clause Mod',
    'OHKO Clause',
    'Evasion Clause',
    'Endless Battle Clause',
    'Moody Clause',
    'Item Clause',
    'Batonpass Clause',
  ],
  bans: {
    pokemon: ['Mewtwo', 'Lugia', 'Kyogre'],
    moves: ['Baton Pass'],
    items: ["King's Rock", 'Razor Fang', 'Light Clay'],
    abilities: [],
  },
  additions: { pokemon: [] },
  team_constraints: {
    tera_match: 'player_core',
    type_quotas: {
      source: 'player_core',
      min_per_type: 2,
      allow_multi_count: true,
    },
    evolution_stage: {
      mode: 'nfe_only_plus_n_fe',
      fully_evolved_cap: 1,
      legendaries_allowed: false,
      fully_evolved_tier_max: 'ZU',
    },
    eviolite_tier_cap: 'RU',
  },
});

// ── Helpers ───────────────────────────────────────────────────────

function queueMaybeSingleResults(rows: unknown[]) {
  let i = 0;
  vi.mocked(mockBuilder.maybeSingle).mockImplementation(() => {
    const row = rows[i++] ?? null;
    return Promise.resolve({ data: row, error: null });
  });
}

function queueThenResults(rows: unknown[]) {
  let i = 0;
  vi.mocked(mockBuilder.then).mockImplementation(
    (resolve: (value: unknown) => void) =>
      resolve({ data: rows[i++] ?? [], error: null })
  );
}

describe('isCustomLeagueRuleset', () => {
  it('returns false for a base tier ruleset (no team_constraints)', () => {
    expect(isCustomLeagueRuleset(BASE_GEN9RU)).toBe(false);
  });

  it('returns true when team_constraints is set (player_core source)', () => {
    expect(isCustomLeagueRuleset(TYPE_TRIANGLE_LEAGUE)).toBe(true);
  });

  it('returns true when custom_rules_string is non-empty', () => {
    expect(
      isCustomLeagueRuleset(
        makeRuleset({ custom_rules_string: 'All Pokémon must be Gen 9.' })
      )
    ).toBe(true);
  });

  it('returns true when additions.pokemon has entries', () => {
    expect(
      isCustomLeagueRuleset(
        makeRuleset({ additions: { pokemon: ['Pikachu'] } })
      )
    ).toBe(true);
  });
});

describe('resolveEffectiveRuleset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('uses the tournament ruleset directly when it is custom', async () => {
    queueMaybeSingleResults([TYPE_TRIANGLE_LEAGUE]);
    const result = await resolveEffectiveRuleset({
      tournamentRulesetId: TYPE_TRIANGLE_LEAGUE.id,
    });
    expect(result?.ruleset.id).toBe(TYPE_TRIANGLE_LEAGUE.id);
    expect(result?.source).toBe('tournament');
    expect(result?.fellBack).toBe(false);
  });

  // ── Type Triangle League regression ──────────────────────────────────
  it('resolves the Type Triangle League custom ruleset for a round_robin group-phase tournament that incorrectly references base Gen 9 RU', async () => {
    // Tournament.ruleset_id = base Gen 9 RU (the data error we fix).
    // Season.ruleset_id     = base Gen 9 RU.
    // A separate custom "Type Triangle League" ruleset exists.
    queueMaybeSingleResults([BASE_GEN9RU, BASE_GEN9RU]);
    queueThenResults([[TYPE_TRIANGLE_LEAGUE]]);

    const result = await resolveEffectiveRuleset({
      tournamentRulesetId: BASE_GEN9RU.id,
      tournamentBracketType: 'round_robin', // group phase
      season: {
        id: 'season-ttl',
        name: 'Type Triangle League',
        rulesetId: BASE_GEN9RU.id,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.ruleset.id).toBe(TYPE_TRIANGLE_LEAGUE.id);
    expect(result!.ruleset.name).toBe('Type Triangle League');
    expect(result!.ruleset.team_constraints).not.toBeNull();
    expect(result!.ruleset.team_constraints!.type_quotas?.source).toBe('player_core');
    expect(result!.ruleset.team_constraints!.evolution_stage?.mode).toBe(
      'nfe_only_plus_n_fe',
    );
    expect(result!.source).toBe('name-match');
    expect(result!.fellBack).toBe(false);

    expect(console.warn).toHaveBeenCalled();
  });

  // ── Playoffs case: name-match MUST be skipped for elimination brackets ──
  it('does NOT apply name-match for single_elim playoffs (so a TTL playoffs can keep its own "fully RU" ruleset)', async () => {
    // Tournament is a TTL single_elim playoff (the future stage). It
    // intentionally points to base Gen 9 RU. We MUST NOT silently
    // override it with the group's NFE ruleset via name-match.
    queueMaybeSingleResults([BASE_GEN9RU, BASE_GEN9RU, BASE_GEN9RU]);
    queueThenResults([[TYPE_TRIANGLE_LEAGUE]]); // exists but must be ignored

    const result = await resolveEffectiveRuleset({
      tournamentRulesetId: BASE_GEN9RU.id,
      tournamentBracketType: 'single_elim', // playoffs
      season: {
        id: 'season-ttl',
        name: 'Type Triangle League',
        rulesetId: BASE_GEN9RU.id,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.ruleset.id).toBe(BASE_GEN9RU.id);
    expect(result!.source).toBe('fallback');
    expect(result!.fellBack).toBe(true);

    // Fallback warning must fire so the data anomaly is observable.
    const warnCalls = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(warnCalls.some((m) => m.includes('Falling back to base tier ruleset'))).toBe(true);
  });

  it('does NOT apply name-match for double_elim brackets either', async () => {
    queueMaybeSingleResults([BASE_GEN9RU, BASE_GEN9RU, BASE_GEN9RU]);
    queueThenResults([[TYPE_TRIANGLE_LEAGUE]]);

    const result = await resolveEffectiveRuleset({
      tournamentRulesetId: BASE_GEN9RU.id,
      tournamentBracketType: 'double_elim',
      season: {
        id: 'season-ttl',
        name: 'Type Triangle League',
        rulesetId: BASE_GEN9RU.id,
      },
    });

    expect(result?.source).toBe('fallback');
    expect(result?.fellBack).toBe(true);
    expect(result?.ruleset.id).toBe(BASE_GEN9RU.id);
  });

  it('uses the season custom ruleset when the tournament ruleset is base tier', async () => {
    const seasonCustom = makeRuleset({
      id: 'season-custom',
      name: 'Liga Rules',
      team_constraints: {
        type_quotas: {
          source: 'player_core',
          min_per_type: 2,
          allow_multi_count: true,
        },
      },
    });

    queueMaybeSingleResults([BASE_GEN9RU, seasonCustom]);

    const result = await resolveEffectiveRuleset({
      tournamentRulesetId: BASE_GEN9RU.id,
      season: {
        id: 's',
        name: 'Liga',
        rulesetId: seasonCustom.id,
      },
    });

    expect(result?.ruleset.id).toBe(seasonCustom.id);
    expect(result?.source).toBe('season');
    expect(result?.fellBack).toBe(false);
  });

  it('falls back to the base tier ruleset with a warning when no custom ruleset can be resolved', async () => {
    queueMaybeSingleResults([BASE_GEN9RU, BASE_GEN9RU, BASE_GEN9RU]);
    queueThenResults([[]]);

    const result = await resolveEffectiveRuleset({
      tournamentRulesetId: BASE_GEN9RU.id,
      season: {
        id: 's',
        name: 'Some Unconfigured League',
        rulesetId: BASE_GEN9RU.id,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.ruleset.id).toBe(BASE_GEN9RU.id);
    expect(result!.source).toBe('fallback');
    expect(result!.fellBack).toBe(true);

    const warnCalls = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(warnCalls.some((m) => m.includes('Falling back to base tier ruleset'))).toBe(true);
  });

  it('logs no fallback warning for a point-buy season on its own default ruleset', async () => {
    const pointBuyRow = makeRuleset({ id: 'pb-rs', name: 'Point Buy', base_format: 'gen9' });
    queueMaybeSingleResults([pointBuyRow, pointBuyRow, pointBuyRow]);
    queueThenResults([[]]);

    const result = await resolveEffectiveRuleset({
      tournamentRulesetId: pointBuyRow.id,
      tournamentBracketType: 'round_robin',
      season: { id: 's', name: 'PB League', rulesetId: pointBuyRow.id, formatType: 'evolution_point_buy' },
    });

    expect(result?.ruleset.id).toBe(pointBuyRow.id);
    expect(result?.source).toBe('fallback');
    const warnCalls = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(warnCalls.some((m) => m.includes('Falling back to base tier ruleset'))).toBe(false);
  });

  it('still warns for a point-buy phase on a ruleset other than the season default', async () => {
    const pointBuyRow = makeRuleset({ id: 'pb-rs', name: 'Point Buy', base_format: 'gen9' });
    queueMaybeSingleResults([BASE_GEN9RU, pointBuyRow, BASE_GEN9RU]);
    queueThenResults([[]]);

    await resolveEffectiveRuleset({
      tournamentRulesetId: BASE_GEN9RU.id,
      tournamentBracketType: 'round_robin',
      season: { id: 's', name: 'PB League', rulesetId: pointBuyRow.id, formatType: 'evolution_point_buy' },
    });

    const warnCalls = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(warnCalls.some((m) => m.includes('Falling back to base tier ruleset'))).toBe(true);
  });

  it('propagates a failed name-match lookup instead of falling back to the base tier', async () => {
    queueMaybeSingleResults([BASE_GEN9RU, BASE_GEN9RU, BASE_GEN9RU]);
    vi.mocked(mockBuilder.then).mockImplementation((resolve: (value: unknown) => void) =>
      resolve({ data: null, error: { message: 'connection reset', code: '08006' } }),
    );

    await expect(
      resolveEffectiveRuleset({
        tournamentRulesetId: BASE_GEN9RU.id,
        tournamentBracketType: 'round_robin',
        season: { id: 's', name: 'Type Triangle League', rulesetId: BASE_GEN9RU.id },
      }),
    ).rejects.toMatchObject({ message: 'connection reset' });
  });

  it('returns null when no ruleset can be resolved at all', async () => {
    queueMaybeSingleResults([null]);
    const result = await resolveEffectiveRuleset({
      tournamentRulesetId: 'does-not-exist',
    });
    expect(result).toBeNull();
  });

  it('skips name-based lookup when the only ruleset with the matching name is itself non-custom', async () => {
    queueMaybeSingleResults([BASE_GEN9RU, BASE_GEN9RU, BASE_GEN9RU]);
    queueThenResults([[BASE_GEN9RU]]);

    const result = await resolveEffectiveRuleset({
      tournamentRulesetId: BASE_GEN9RU.id,
      season: {
        id: 's',
        name: 'Gen 9 RU',
        rulesetId: BASE_GEN9RU.id,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe('fallback');
    expect(result!.fellBack).toBe(true);
  });
});
