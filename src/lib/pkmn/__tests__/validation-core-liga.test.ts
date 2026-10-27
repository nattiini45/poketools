import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PokemonSet, StatSpread } from '@/types/team';
import type { Ruleset, TeamConstraints } from '@/types/ruleset';
import type { CoreTriple } from '@/types/season';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../dex', () => ({
  getSpecies: vi.fn(),
  getMove: vi.fn(),
  getItem: vi.fn(),
  getAbility: vi.fn(),
  isFullyEvolved: vi.fn(),
  isLegendary: vi.fn(),
}));

vi.mock('../tiers', () => ({
  compareTier: vi.fn(),
  computeEvioliteBannedSpecies: vi.fn(),
  normalizeTier: vi.fn(),
}));

import {
  getSpecies,
  getMove,
  getItem,
  getAbility,
  isFullyEvolved,
  isLegendary,
} from '../dex';
import {
  compareTier,
  computeEvioliteBannedSpecies,
  normalizeTier,
} from '../tiers';
import { validateTeam } from '../validation';
import { makeRuleset as buildRuleset } from '@/test/ruleset-fixtures';

// ── Fixtures ───────────────────────────────────────────────────────

const DEFAULT_EVS: StatSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const DEFAULT_IVS: StatSpread = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

const SINGLES_ORDER = ['ZU', 'PU', 'PUBL', 'NU', 'NUBL', 'RU', 'RUBL', 'UU', 'UUBL', 'OU', 'Uber', 'AG'];

function makeSet(species: string, overrides?: Partial<PokemonSet>): PokemonSet {
  return {
    name: '',
    species,
    gender: '',
    item: 'Leftovers',
    ability: 'Drizzle',
    evs: DEFAULT_EVS,
    ivs: DEFAULT_IVS,
    nature: 'Modest',
    level: 100,
    moves: ['Tackle'],
    ...overrides,
  };
}

function makeRuleset(team_constraints: TeamConstraints | null): Ruleset {
  return buildRuleset({
    id: 'ruleset-1',
    name: 'Core Liga',
    base_format: 'gen9ru',
    is_doubles: false,
    clauses: [],
    bans: { pokemon: [], moves: [], items: [], abilities: [] },
    additions: { pokemon: [] },
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints,
    created_by: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
  });
}

// Dex catalogue used across the constraint tests. Each entry includes the
// fields the validator reads (types, tier, name).
const DEX: Record<string, { name: string; types: string[]; tier: string; nfe: boolean; legendary: boolean }> = {
  // Multi-type fire mons
  Volcanion:   { name: 'Volcanion',   types: ['Fire', 'Water'],  tier: 'RU',  nfe: false, legendary: true  },
  Scovillain:  { name: 'Scovillain',  types: ['Fire', 'Grass'],  tier: 'PU',  nfe: false, legendary: false },
  Magmar:      { name: 'Magmar',      types: ['Fire'],            tier: '(PU)', nfe: true,  legendary: false },
  // Pure water / grass
  Quagsire:    { name: 'Quagsire',    types: ['Water', 'Ground'], tier: 'RU',  nfe: false, legendary: false },
  Wartortle:   { name: 'Wartortle',   types: ['Water'],           tier: '(RU)', nfe: true,  legendary: false },
  Ivysaur:     { name: 'Ivysaur',     types: ['Grass', 'Poison'], tier: '(OU)', nfe: true,  legendary: false },
  Whimsicott:  { name: 'Whimsicott',  types: ['Grass', 'Fairy'],  tier: 'OU',  nfe: false, legendary: false },
  // NFE with above-RU evolution → Eviolite-banned
  Bisharp:     { name: 'Bisharp',     types: ['Dark', 'Steel'],   tier: '(OU)', nfe: true,  legendary: false },
  Duraludon:   { name: 'Duraludon',   types: ['Steel', 'Dragon'], tier: '(UU)', nfe: true,  legendary: false },
  // ZU-tier FE for exception
  Vileplume:   { name: 'Vileplume',   types: ['Grass', 'Poison'], tier: 'ZU',  nfe: false, legendary: false },
  // Filler off-core mon
  Pikachu:     { name: 'Pikachu',     types: ['Electric'],        tier: '(PU)', nfe: true,  legendary: false },
};

function setupDexMocks() {
  vi.mocked(getSpecies).mockImplementation(((name: string) => DEX[name]) as unknown as typeof getSpecies);
  vi.mocked(getMove).mockImplementation(((name: string) => ({ name })) as unknown as typeof getMove);
  vi.mocked(getItem).mockImplementation(((name: string) => ({ name })) as unknown as typeof getItem);
  vi.mocked(getAbility).mockImplementation(((name: string) => ({ name })) as unknown as typeof getAbility);

  vi.mocked(isFullyEvolved).mockImplementation(((name: string) => {
    return !(DEX[name]?.nfe ?? true);
  }) as typeof isFullyEvolved);

  vi.mocked(isLegendary).mockImplementation(((name: string) => DEX[name]?.legendary ?? false) as typeof isLegendary);

  vi.mocked(normalizeTier).mockImplementation(((raw: string | null | undefined) => {
    if (!raw) return null;
    if (SINGLES_ORDER.includes(raw)) return raw as never;
    if (raw.startsWith('(') && raw.endsWith(')')) return 'ZU' as never;
    return null;
  }) as unknown as typeof normalizeTier);

  vi.mocked(compareTier).mockImplementation(((a: string, b: string) => {
    const ai = SINGLES_ORDER.indexOf(a);
    const bi = SINGLES_ORDER.indexOf(b);
    return Math.sign(ai - bi);
  }) as unknown as typeof compareTier);

  // Eviolite ban set: NFEs whose evolution is above RU. In our DEX the only
  // NFEs whose `tier` (their evo's tier parenthesised) is above RU are
  // Bisharp ((OU)) and Duraludon ((UU)).
  vi.mocked(computeEvioliteBannedSpecies).mockImplementation(((_gen: number, cap: string) => {
    const set = new Set<string>();
    for (const name in DEX) {
      const s = DEX[name];
      if (!s.nfe) continue;
      const stripped = s.tier.startsWith('(') && s.tier.endsWith(')')
        ? s.tier.slice(1, -1)
        : null;
      if (!stripped) continue;
      const ai = SINGLES_ORDER.indexOf(stripped);
      const bi = SINGLES_ORDER.indexOf(cap);
      if (ai > bi) set.add(s.name.toLowerCase());
    }
    return set;
  }) as unknown as typeof computeEvioliteBannedSpecies);
}

// ── Tests ──────────────────────────────────────────────────────────

describe('validateTeam — Core Liga team_constraints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDexMocks();
  });

  // ── 1. Type quotas ────────────────────────────────────────────────
  describe('type quotas', () => {
    const playerCore: CoreTriple = ['Fire', 'Water', 'Grass'];
    const constraints: TeamConstraints = {
      type_quotas: { source: 'player_core', min_per_type: 2, allow_multi_count: true },
    };

    it('passes when each core type has 2 dedicated Pokémon', () => {
      const team = [
        makeSet('Volcanion'),  // Fire + Water → counts twice
        makeSet('Scovillain'), // Fire + Grass → counts twice
        makeSet('Quagsire'),   // Water
        makeSet('Whimsicott'), // Grass
        makeSet('Pikachu'),    // off-core
      ];
      const result = validateTeam(team, makeRuleset(constraints), { playerCore });
      expect(result.team_issues).toEqual([]);
    });

    it('fails when a core type has too few Pokémon', () => {
      const team = [
        makeSet('Volcanion'),  // Fire + Water
        makeSet('Quagsire'),   // Water → Water count = 2
        makeSet('Whimsicott'), // Grass → Grass count = 1
        makeSet('Magmar'),     // Fire → Fire count = 2
        makeSet('Pikachu'),    // off-core
      ];
      const result = validateTeam(team, makeRuleset(constraints), { playerCore });
      expect(result.team_issues.some((m) => m.includes('Grass'))).toBe(true);
    });

    it('demands a player core to be assigned when source = player_core', () => {
      const result = validateTeam(
        [makeSet('Volcanion')],
        makeRuleset(constraints),
        { playerCore: null },
      );
      expect(result.team_issues.some((m) => m.startsWith('Type quota rule'))).toBe(true);
    });

    it('emits no quota issue when team has 4 Volcanion (multi-count), 1 Whimsicott, 1 Scovillain', () => {
      const playerCore3: CoreTriple = ['Fire', 'Water', 'Grass'];
      const team = [
        makeSet('Volcanion'),  // Fire + Water
        makeSet('Volcanion'),  // Fire + Water
        makeSet('Scovillain'), // Fire + Grass
        makeSet('Whimsicott'), // Grass
      ];
      const result = validateTeam(team, makeRuleset(constraints), { playerCore: playerCore3 });
      const quotaIssues = result.team_issues.filter((m) => m.startsWith('Type quota'));
      expect(quotaIssues).toEqual([]);
    });
  });

  // ── 2. Tera match ────────────────────────────────────────────────
  describe('tera match', () => {
    const playerCore: CoreTriple = ['Fire', 'Water', 'Grass'];

    it('errors when tera type is outside the player core', () => {
      const team = [makeSet('Volcanion', { tera_type: 'Electric' })];
      const result = validateTeam(
        team,
        makeRuleset({ tera_match: 'player_core' }),
        { playerCore },
      );
      expect(result.issues.some((i) => i.issue.includes('Tera type Electric'))).toBe(true);
    });

    it('passes when tera type matches a core type', () => {
      const team = [makeSet('Volcanion', { tera_type: 'Water' })];
      const result = validateTeam(
        team,
        makeRuleset({ tera_match: 'player_core' }),
        { playerCore },
      );
      expect(result.issues.filter((i) => i.issue.includes('Tera'))).toEqual([]);
    });

    it('errors with team_types mode when tera mismatches species types', () => {
      const team = [makeSet('Volcanion', { tera_type: 'Grass' })]; // Volcanion is Fire/Water
      const result = validateTeam(
        team,
        makeRuleset({ tera_match: 'team_types' }),
        { playerCore },
      );
      expect(result.issues.some((i) => i.issue.includes('Tera type Grass'))).toBe(true);
    });
  });

  // ── 3. Evolution stage (NFE-only + N exceptions) ─────────────────
  describe('evolution stage (NFE-only + N FE exceptions)', () => {
    const playerCore: CoreTriple = ['Fire', 'Water', 'Grass'];
    const constraints: TeamConstraints = {
      evolution_stage: {
        mode: 'nfe_only_plus_n_fe',
        fully_evolved_cap: 1,
        fully_evolved_tier_max: 'ZU',
        legendaries_allowed: false,
      },
    };

    it('allows all-NFE plus one ZU fully-evolved exception', () => {
      const team = [
        makeSet('Magmar'),     // NFE
        makeSet('Wartortle'),  // NFE
        makeSet('Ivysaur'),    // NFE
        makeSet('Bisharp'),    // NFE
        makeSet('Duraludon'),  // NFE
        makeSet('Vileplume'),  // FE in ZU
      ];
      const result = validateTeam(team, makeRuleset(constraints), { playerCore });
      const evoIssues = [
        ...result.team_issues.filter((m) => m.startsWith('Evolution stage rule')),
        ...result.issues.filter((i) => i.issue.includes('phase cap')),
      ];
      expect(evoIssues).toEqual([]);
    });

    it('rejects more than one fully-evolved Pokémon', () => {
      const team = [
        makeSet('Magmar'),     // NFE
        makeSet('Vileplume'),  // FE in ZU
        makeSet('Volcanion'),  // FE in RU (also legendary — separate error)
      ];
      const result = validateTeam(team, makeRuleset(constraints), { playerCore });
      expect(result.team_issues.some((m) => m.includes('Evolution stage rule'))).toBe(true);
    });

    it('rejects a fully-evolved Pokémon above the tier cap', () => {
      const team = [
        makeSet('Magmar'),     // NFE
        makeSet('Whimsicott'), // FE in OU — over the ZU cap
      ];
      const result = validateTeam(team, makeRuleset(constraints), { playerCore });
      expect(result.issues.some((i) => i.issue.includes('tier (OU) is above'))).toBe(true);
    });

    it('rejects legendaries when legendaries_allowed = false', () => {
      const team = [
        makeSet('Magmar'),     // NFE
        makeSet('Volcanion'),  // FE legendary
      ];
      const result = validateTeam(team, makeRuleset(constraints), { playerCore });
      expect(result.issues.some((i) => i.issue.includes('legendary'))).toBe(true);
    });
  });

  // ── 4. Eviolite cap ──────────────────────────────────────────────
  describe('Eviolite tier cap', () => {
    const playerCore: CoreTriple = ['Fire', 'Water', 'Grass'];

    it('blocks Eviolite on Bisharp (evolution is OU, above RU cap)', () => {
      const team = [makeSet('Bisharp', { item: 'Eviolite' })];
      const result = validateTeam(
        team,
        makeRuleset({ eviolite_tier_cap: 'RU' }),
        { playerCore },
      );
      expect(result.issues.some((i) => i.issue.includes('Eviolite'))).toBe(true);
    });

    it('blocks Eviolite on Duraludon (evolution is UU, above RU cap)', () => {
      const team = [makeSet('Duraludon', { item: 'Eviolite' })];
      const result = validateTeam(
        team,
        makeRuleset({ eviolite_tier_cap: 'RU' }),
        { playerCore },
      );
      expect(result.issues.some((i) => i.issue.includes('Eviolite'))).toBe(true);
    });

    it('allows Eviolite on NFEs whose evolution is at or below the cap', () => {
      const team = [makeSet('Wartortle', { item: 'Eviolite' })]; // evolves to Blastoise (RU)
      const result = validateTeam(
        team,
        makeRuleset({ eviolite_tier_cap: 'RU' }),
        { playerCore },
      );
      expect(result.issues.some((i) => i.issue.includes('Eviolite'))).toBe(false);
    });

    it('does not block Eviolite when species is not holding it', () => {
      const team = [makeSet('Bisharp', { item: 'Leftovers' })];
      const result = validateTeam(
        team,
        makeRuleset({ eviolite_tier_cap: 'RU' }),
        { playerCore },
      );
      expect(result.issues.some((i) => i.issue.includes('Eviolite'))).toBe(false);
    });
  });

  // ── 5. Backwards compatibility ────────────────────────────────────
  describe('backwards compatibility', () => {
    it('skips constraint checks when team_constraints is null', () => {
      const team = [makeSet('Whimsicott')]; // FE OU mon — would fail NFE-only
      const result = validateTeam(team, makeRuleset(null), { playerCore: null });
      // No team-level evo issues; only structural / clause checks remain
      expect(result.team_issues.filter((m) => m.includes('Evolution'))).toEqual([]);
    });

    it('still accepts the legacy 3rd-arg drafted-Pokémon array', () => {
      const team = [makeSet('Whimsicott')];
      const result = validateTeam(team, makeRuleset(null), ['Pikachu']);
      expect(result.team_issues.some((m) => m.includes('not in your draft roster'))).toBe(true);
    });
  });
});
