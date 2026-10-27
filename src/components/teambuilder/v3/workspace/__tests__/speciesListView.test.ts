import { describe, it, expect } from 'vitest';
import {
  buildSpeciesListView,
  applySortClick,
  MAX_SORT_CRITERIA,
  type SpeciesListOptions,
  type SortCriterion,
} from '../speciesListView';
import { tierRank } from '@/lib/pkmn/tier-constants';
import type { UsageListItem } from '@/types/usage';

// ── Fixtures ────────────────────────────────────────────────────────

function mon(
  name: string,
  overrides: Partial<UsageListItem> = {},
): UsageListItem {
  return {
    pokemon_name: name,
    usage_pct: 0,
    types: ['Normal'],
    sprite_id: name.toLowerCase(),
    source: 'meta',
    base_stats: { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50 },
    tier: 'OU',
    legal: true,
    ...overrides,
  };
}

function baseOpts(overrides: Partial<SpeciesListOptions> = {}): SpeciesListOptions {
  return {
    query: '',
    typeFilters: [],
    sortCriteria: [],
    groupByTier: false,
    applyLegality: false,
    poolCosts: null,
    showTaken: false,
    takenSet: new Set(),
    rosterSet: new Set(),
    teamSpecies: new Set(),
    ...overrides,
  };
}

// ── Legality filter ─────────────────────────────────────────────────

describe('buildSpeciesListView — legality', () => {
  const list = [
    mon('Legal', { legal: true }),
    mon('Illegal', { legal: false }),
    mon('Unknown', { legal: undefined }),
  ];

  it('hides illegal mons when applyLegality is on', () => {
    const { items } = buildSpeciesListView(list, baseOpts({ applyLegality: true }));
    expect(items.map((p) => p.pokemon_name)).toEqual(['Legal', 'Unknown']);
  });

  it('keeps everything when applyLegality is off', () => {
    const { items } = buildSpeciesListView(list, baseOpts({ applyLegality: false }));
    expect(items).toHaveLength(3);
  });

  it('treats undefined legal as visible', () => {
    const { items } = buildSpeciesListView([mon('U', { legal: undefined })], baseOpts({ applyLegality: true }));
    expect(items).toHaveLength(1);
  });
});

// ── Ruleset overrides (bans / additions) ────────────────────────────

describe('buildSpeciesListView — ruleset overrides', () => {
  it('extraBans hides an otherwise-legal mon', () => {
    const list = [mon('Keep', { legal: true }), mon('Banned', { legal: true })];
    const { items } = buildSpeciesListView(
      list,
      baseOpts({ applyLegality: true, extraBans: new Set(['banned']) }),
    );
    expect(items.map((p) => p.pokemon_name)).toEqual(['Keep']);
  });

  it('additions unban an otherwise-illegal mon', () => {
    const list = [mon('Unbanned', { legal: false }), mon('StillIllegal', { legal: false })];
    const { items } = buildSpeciesListView(
      list,
      baseOpts({ applyLegality: true, additions: new Set(['unbanned']) }),
    );
    expect(items.map((p) => p.pokemon_name)).toEqual(['Unbanned']);
  });

  it('an explicit ban wins over an addition', () => {
    const list = [mon('Conflict', { legal: false })];
    const { items } = buildSpeciesListView(
      list,
      baseOpts({
        applyLegality: true,
        extraBans: new Set(['conflict']),
        additions: new Set(['conflict']),
      }),
    );
    expect(items).toHaveLength(0);
  });

  it('an allowlist makes only the listed species legal, whatever the base-format flag says', () => {
    const list = [mon('Listed', { legal: false }), mon('Other', { legal: true }), mon('Banned', { legal: true })];
    const { items } = buildSpeciesListView(
      list,
      baseOpts({ applyLegality: true, allowOnly: new Set(['listed', 'banned']), extraBans: new Set(['banned']) }),
    );
    // The allowlist replaces bans and the legality flag: a ruleset in allowlist mode has no bans of its own.
    expect(items.map((p) => p.pokemon_name)).toEqual(['Listed', 'Banned']);
  });

  it('no allowlist (null) leaves the base-format legality alone', () => {
    const list = [mon('Keep', { legal: true }), mon('Gone', { legal: false })];
    const { items } = buildSpeciesListView(list, baseOpts({ applyLegality: true, allowOnly: null }));
    expect(items.map((p) => p.pokemon_name)).toEqual(['Keep']);
  });

  it('overrides are ignored when applyLegality is off', () => {
    const list = [mon('Banned', { legal: true })];
    const { items } = buildSpeciesListView(
      list,
      baseOpts({ applyLegality: false, extraBans: new Set(['banned']) }),
    );
    expect(items).toHaveLength(1);
  });
});

// ── Multi-criteria sort ─────────────────────────────────────────────

describe('buildSpeciesListView — multi-sort', () => {
  it('sorts by primary then secondary criterion', () => {
    const list = [
      mon('A', { base_stats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 100 } }),
      mon('B', { base_stats: { hp: 1, atk: 1, def: 1, spa: 9, spd: 1, spe: 100 } }),
      mon('C', { base_stats: { hp: 1, atk: 1, def: 1, spa: 5, spd: 1, spe: 50 } }),
    ];
    const { items } = buildSpeciesListView(
      list,
      baseOpts({
        sortCriteria: [
          { key: 'spe', dir: 'desc' },
          { key: 'spa', dir: 'desc' },
        ],
      }),
    );
    // Spe 100 group first (B before A by SpA), then C.
    expect(items.map((p) => p.pokemon_name)).toEqual(['B', 'A', 'C']);
  });

  it('tier desc puts best tier first and untiered last', () => {
    const list = [
      mon('Untiered', { tier: null }),
      mon('OUmon', { tier: 'OU' }),
      mon('AGmon', { tier: 'AG' }),
      mon('LCmon', { tier: 'LC' }),
    ];
    const { items } = buildSpeciesListView(
      list,
      baseOpts({ sortCriteria: [{ key: 'tier', dir: 'desc' }] }),
    );
    expect(items.map((p) => p.pokemon_name)).toEqual(['AGmon', 'OUmon', 'LCmon', 'Untiered']);
  });

  it('is stable — full ties preserve input order', () => {
    const list = [mon('First'), mon('Second'), mon('Third')];
    const { items } = buildSpeciesListView(
      list,
      baseOpts({ sortCriteria: [{ key: 'hp', dir: 'desc' }] }),
    );
    expect(items.map((p) => p.pokemon_name)).toEqual(['First', 'Second', 'Third']);
  });

  it('does not sort with empty criteria', () => {
    const list = [mon('B', { base_stats: { hp: 9, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } }), mon('A', { base_stats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } })];
    const { items } = buildSpeciesListView(list, baseOpts());
    expect(items.map((p) => p.pokemon_name)).toEqual(['B', 'A']);
  });
});

// ── Tier grouping ───────────────────────────────────────────────────

describe('buildSpeciesListView — grouping', () => {
  const list = [
    mon('Lc1', { tier: 'LC' }),
    mon('Ou1', { tier: 'OU', base_stats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 10 } }),
    mon('Ou2', { tier: 'OU', base_stats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 99 } }),
    mon('Un1', { tier: null }),
    mon('Ag1', { tier: 'AG' }),
  ];

  it('orders groups by tier rank with untiered last', () => {
    const { groups } = buildSpeciesListView(list, baseOpts({ groupByTier: true }));
    expect(groups).not.toBeNull();
    expect(groups!.map((g) => g.label)).toEqual(['AG', 'OU', 'LC', '—']);
  });

  it('sorts within each group', () => {
    const { groups } = buildSpeciesListView(
      list,
      baseOpts({ groupByTier: true, sortCriteria: [{ key: 'spe', dir: 'desc' }] }),
    );
    const ou = groups!.find((g) => g.label === 'OU')!;
    expect(ou.items.map((p) => p.pokemon_name)).toEqual(['Ou2', 'Ou1']);
  });

  it('flat items equal the concatenation of groups', () => {
    const { items, groups } = buildSpeciesListView(list, baseOpts({ groupByTier: true }));
    expect(items).toEqual(groups!.flatMap((g) => g.items));
  });
});

// ── Draft interactions ──────────────────────────────────────────────

describe('buildSpeciesListView — draft', () => {
  const pool = new Map<string, number | null>([
    ['inpool', 10],
    ['cheap', 3],
  ]);
  const list = [mon('InPool'), mon('Cheap'), mon('OutOfPool')];

  it('pool membership wins (only pool mons listed)', () => {
    const { items } = buildSpeciesListView(list, baseOpts({ poolCosts: pool }));
    expect(items.map((p) => p.pokemon_name).sort()).toEqual(['Cheap', 'InPool']);
  });

  it('pick sort uses cost in draft mode', () => {
    const { items } = buildSpeciesListView(
      list,
      baseOpts({ poolCosts: pool, sortCriteria: [{ key: 'pick', dir: 'desc' }] }),
    );
    expect(items.map((p) => p.pokemon_name)).toEqual(['InPool', 'Cheap']);
  });

  it('legality is independent of pool filtering', () => {
    // applyLegality is off in draft; illegal pool mons remain visible.
    const draftList = [mon('InPool', { legal: false })];
    const { items } = buildSpeciesListView(
      draftList,
      baseOpts({ poolCosts: pool, applyLegality: false }),
    );
    expect(items).toHaveLength(1);
  });
});

// ── Localized search and display-name sort ─────────────────────────

describe('buildSpeciesListView — localized names', () => {
  const list = [mon('Pikachu'), mon('Charizard'), mon('Blastoise'), mon('Charmander'), mon('Scream Tail')];
  const names = (items: UsageListItem[]) => items.map((p) => p.pokemon_name);

  it('a German query filters, whatever the data locale', () => {
    expect(names(buildSpeciesListView(list, baseOpts({ query: 'Glurak' })).items)).toEqual(['Charizard']);
    expect(names(buildSpeciesListView(list, baseOpts({ query: 'glurak' }), 'de').items)).toEqual(['Charizard']);
    expect(names(buildSpeciesListView(list, baseOpts({ query: 'bruellschweif' })).items)).toEqual(['Scream Tail']);
  });

  it('an English query still filters, ranked exact/prefix before substring', () => {
    expect(names(buildSpeciesListView(list, baseOpts({ query: 'char' })).items)).toEqual(['Charizard', 'Charmander']);
    // "toise" is a substring of Blastoise only; Turtok (German) does not contain it.
    expect(names(buildSpeciesListView(list, baseOpts({ query: 'toise' })).items)).toEqual(['Blastoise']);
    expect(names(buildSpeciesListView(list, baseOpts({ query: 'Charizard' }), 'de').items)).toEqual(['Charizard']);
  });

  it("sorts by German display name under 'de'", () => {
    const { items } = buildSpeciesListView(
      list,
      baseOpts({ sortCriteria: [{ key: 'name', dir: 'asc' }] }),
      'de',
    );
    // Brüllschweif (Scream Tail), Glumanda (Charmander), Glurak (Charizard), Pikachu, Turtok (Blastoise)
    expect(names(items)).toEqual(['Scream Tail', 'Charmander', 'Charizard', 'Pikachu', 'Blastoise']);
  });

  it('existing calls without the locale argument keep English order', () => {
    const { items } = buildSpeciesListView(list, baseOpts({ sortCriteria: [{ key: 'name', dir: 'asc' }] }));
    expect(names(items)).toEqual(['Blastoise', 'Charizard', 'Charmander', 'Pikachu', 'Scream Tail']);
    const desc = buildSpeciesListView(list, baseOpts({ sortCriteria: [{ key: 'name', dir: 'desc' }] }));
    expect(names(desc.items)).toEqual(['Scream Tail', 'Pikachu', 'Charmander', 'Charizard', 'Blastoise']);
  });

  it('name works as a secondary criterion', () => {
    const tied = [
      mon('Pikachu', { tier: 'OU' }),
      mon('Charizard', { tier: 'UU' }),
      mon('Blastoise', { tier: 'OU' }),
    ];
    const { items } = buildSpeciesListView(
      tied,
      baseOpts({ sortCriteria: [{ key: 'tier', dir: 'desc' }, { key: 'name', dir: 'asc' }] }),
      'de',
    );
    expect(names(items)).toEqual(['Pikachu', 'Blastoise', 'Charizard']);
  });
});

// ── applySortClick ──────────────────────────────────────────────────

describe('applySortClick', () => {
  it('click on an empty stack appends the key as desc', () => {
    expect(applySortClick([], 'spe')).toEqual([{ key: 'spe', dir: 'desc' }]);
  });

  it('clicking a new key appends it (does not replace)', () => {
    const prev: SortCriterion[] = [{ key: 'spe', dir: 'desc' }];
    expect(applySortClick(prev, 'spa')).toEqual([
      { key: 'spe', dir: 'desc' },
      { key: 'spa', dir: 'desc' },
    ]);
  });

  it('clicking an existing key cycles it in place desc → asc → removed', () => {
    const asc = applySortClick([{ key: 'spe', dir: 'desc' }], 'spe');
    expect(asc).toEqual([{ key: 'spe', dir: 'asc' }]);
    expect(applySortClick(asc, 'spe')).toEqual([]);
  });

  it('cycles a non-last criterion without disturbing the others', () => {
    const prev: SortCriterion[] = [
      { key: 'spe', dir: 'desc' },
      { key: 'spa', dir: 'desc' },
    ];
    const asc = applySortClick(prev, 'spe');
    expect(asc).toEqual([
      { key: 'spe', dir: 'asc' },
      { key: 'spa', dir: 'desc' },
    ]);
    // Once more removes it, keeping the secondary.
    expect(applySortClick(asc, 'spe')).toEqual([{ key: 'spa', dir: 'desc' }]);
  });

  it('is a no-op when appending a new key at the cap', () => {
    const prev: SortCriterion[] = [
      { key: 'spe', dir: 'desc' },
      { key: 'spa', dir: 'desc' },
      { key: 'atk', dir: 'desc' },
    ];
    expect(prev).toHaveLength(MAX_SORT_CRITERIA);
    expect(applySortClick(prev, 'hp')).toBe(prev);
  });

  it('name starts ascending (A→Z) and cycles asc → desc → removed', () => {
    const first = applySortClick([], 'name');
    expect(first).toEqual([{ key: 'name', dir: 'asc' }]);
    const second = applySortClick(first, 'name');
    expect(second).toEqual([{ key: 'name', dir: 'desc' }]);
    expect(applySortClick(second, 'name')).toEqual([]);
  });

  it('still cycles an existing key even at the cap', () => {
    const prev: SortCriterion[] = [
      { key: 'spe', dir: 'desc' },
      { key: 'spa', dir: 'desc' },
      { key: 'atk', dir: 'desc' },
    ];
    expect(applySortClick(prev, 'atk')).toEqual([
      { key: 'spe', dir: 'desc' },
      { key: 'spa', dir: 'desc' },
      { key: 'atk', dir: 'asc' },
    ]);
  });
});

// ── Tier-constants sanity ───────────────────────────────────────────

describe('tierRank ordering', () => {
  it('ranks AG above OU above LC above untiered', () => {
    expect(tierRank('AG')).toBeLessThan(tierRank('OU'));
    expect(tierRank('OU')).toBeLessThan(tierRank('LC'));
    expect(tierRank('LC')).toBeLessThan(tierRank(null));
  });
});
