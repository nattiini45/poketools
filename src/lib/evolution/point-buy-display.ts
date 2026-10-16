/**
 * Point-buy list display helpers (client-safe, pure). They return keys and
 * canonical English names, never display text: the components translate
 * `stageNumber` (`draft/legacy.stage`) and `teraRule` (`draft/legacy.tera.*`)
 * and localize species through `src/lib/pkmn/i18n` (draft-frontend §8.5).
 */
import type { PointBuyListEntry, PriceGroup, SpeciesIds } from '@/types/point-buy';
import type { TeamRole } from '@/types/format-rules';
import { getTeraEligibility } from '@/lib/draft/point-buy-engine';
import { epbPack } from '@/lib/format-pack';
import { speciesSearchKeys } from '@/lib/pkmn/i18n/names/species';
import { matchRank, NO_MATCH } from '@/lib/pkmn/i18n/search';

export type EvolutionStageKey = 'base' | 'stage2' | 'stage3';

/** Tera rule of a stage (format pack `epb.teraByStage`); the key of its label in `draft/legacy.tera`. */
export type TeraRuleKey = 'any' | 'stab_only' | 'none';

export interface StageDisplay {
  key: EvolutionStageKey;
  species: string;
  /** Stage number; the component renders `draft/legacy.stage` with it. */
  stageNumber: 1 | 2 | 3;
  types: string[];
  teraRule: TeraRuleKey;
  roles: TeamRole[];
}

/** Resolve the display species name for a line stage (species_ids mirror normalized names). */
export function speciesNameForStage(
  entry: PointBuyListEntry,
  stage: EvolutionStageKey,
): string {
  switch (stage) {
    case 'base':
      return entry.base_pokemon;
    case 'stage2':
      return entry.stage2_pokemon;
    case 'stage3':
      return entry.stage3_pokemon ?? entry.stage2_pokemon;
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

/** Validate species_ids when present; always returns canonical display names. */
export function resolveSpeciesIds(entry: PointBuyListEntry): SpeciesIds {
  return {
    base: entry.species_ids?.base ?? entry.base_pokemon.toLowerCase().replace(/[^a-z0-9]/g, ''),
    stage2: entry.species_ids?.stage2 ?? entry.stage2_pokemon.toLowerCase().replace(/[^a-z0-9]/g, ''),
    stage3: entry.stage3_pokemon
      ? (entry.species_ids?.stage3 ?? entry.stage3_pokemon.toLowerCase().replace(/[^a-z0-9]/g, ''))
      : null,
  };
}

export function stagesForEntry(
  entry: PointBuyListEntry,
  typesBySpecies: Record<string, string[]>,
  rolesBySpecies: Record<string, TeamRole[]>,
  bannedMoves: Set<string>,
): StageDisplay[] {
  const stages: StageDisplay[] = [
    {
      key: 'base',
      species: entry.base_pokemon,
      stageNumber: 1,
      types: typesBySpecies[entry.base_pokemon] ?? [],
      teraRule: getTeraEligibility(1),
      roles: filterRoles(rolesBySpecies[entry.base_pokemon] ?? [], bannedMoves),
    },
    {
      key: 'stage2',
      species: entry.stage2_pokemon,
      stageNumber: 2,
      types: typesBySpecies[entry.stage2_pokemon] ?? [],
      teraRule: getTeraEligibility(2),
      roles: filterRoles(rolesBySpecies[entry.stage2_pokemon] ?? [], bannedMoves),
    },
  ];

  if (entry.stage3_pokemon) {
    stages.push({
      key: 'stage3',
      species: entry.stage3_pokemon,
      stageNumber: 3,
      types: typesBySpecies[entry.stage3_pokemon] ?? [],
      teraRule: getTeraEligibility(3),
      roles: filterRoles(rolesBySpecies[entry.stage3_pokemon] ?? [], bannedMoves),
    });
  }

  return stages;
}

function filterRoles(roles: TeamRole[], bannedMoves: Set<string>): TeamRole[] {
  return roles.filter((r) => r.is_active && !bannedMoves.has(r.move_name.toLowerCase()));
}

/**
 * Price range of each price group (`PriceGroup`, `src/types/point-buy.ts`), from the active format pack
 * (`epb.priceGroups`, `@/lib/format-pack`).
 * The group label comes from `enums.priceGroup`; the components render `draft/legacy.priceGroupRange`.
 */
export const PRICE_GROUP_RANGES: Readonly<Record<PriceGroup, readonly [min: number, max: number]>> = epbPack.priceGroups;

export type SpecialRuleFilter =
  | 'scatterbug'
  | 'no_cocoon_rule'
  | 'cosmog'
  | 'no_redraft'
  | 'has_text';

export interface PointBuyFilters {
  search: string;
  priceGroup: string;
  priceMin: number | null;
  priceMax: number | null;
  type: string;
  killsS2: number | null;
  killsS3: number | null;
  early: number | null;
  mid: number | null;
  late: number | null;
  specialRule: SpecialRuleFilter | '';
  teamRole: string;
}

export const DEFAULT_POINT_BUY_FILTERS: PointBuyFilters = {
  search: '',
  priceGroup: '',
  priceMin: null,
  priceMax: null,
  type: '',
  killsS2: null,
  killsS3: null,
  early: null,
  mid: null,
  late: null,
  specialRule: '',
  teamRole: '',
};

export function parsePointBuyFilters(params: URLSearchParams): PointBuyFilters {
  const num = (key: string): number | null => {
    const v = params.get(key);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    search: params.get('q') ?? '',
    priceGroup: params.get('pg') ?? '',
    priceMin: num('pmin'),
    priceMax: num('pmax'),
    type: params.get('type') ?? '',
    killsS2: num('k2'),
    killsS3: num('k3'),
    early: num('early'),
    mid: num('mid'),
    late: num('late'),
    specialRule: (params.get('sr') ?? '') as PointBuyFilters['specialRule'],
    teamRole: params.get('role') ?? '',
  };
}

export function pointBuyFiltersToParams(filters: PointBuyFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set('q', filters.search);
  if (filters.priceGroup) params.set('pg', filters.priceGroup);
  if (filters.priceMin !== null) params.set('pmin', String(filters.priceMin));
  if (filters.priceMax !== null) params.set('pmax', String(filters.priceMax));
  if (filters.type) params.set('type', filters.type);
  if (filters.killsS2 !== null) params.set('k2', String(filters.killsS2));
  if (filters.killsS3 !== null) params.set('k3', String(filters.killsS3));
  if (filters.early !== null) params.set('early', String(filters.early));
  if (filters.mid !== null) params.set('mid', String(filters.mid));
  if (filters.late !== null) params.set('late', String(filters.late));
  if (filters.specialRule) params.set('sr', filters.specialRule);
  if (filters.teamRole) params.set('role', filters.teamRole);
  return params;
}

/**
 * True when the search query matches any of the line's three stages, in English or German
 * (accents, umlaut transliteration and word prefixes included; `speciesSearchKeys`).
 * An empty query matches every line.
 */
export function lineMatchesSearch(entry: PointBuyListEntry, query: string): boolean {
  const species = [entry.base_pokemon, entry.stage2_pokemon, entry.stage3_pokemon];
  return species.some((name) => !!name && matchRank(query, speciesSearchKeys(name)) !== NO_MATCH);
}

export function filterPointBuyEntries(
  entries: PointBuyListEntry[],
  filters: PointBuyFilters,
  typesBySpecies: Record<string, string[]>,
  rolesBySpecies: Record<string, TeamRole[]>,
): PointBuyListEntry[] {
  let result = entries;

  if (filters.search.trim()) {
    result = result.filter((e) => lineMatchesSearch(e, filters.search));
  }

  if (filters.priceGroup) {
    result = result.filter((e) => e.price_group === filters.priceGroup);
  }

  if (filters.priceMin !== null) {
    result = result.filter((e) => e.price >= filters.priceMin!);
  }
  if (filters.priceMax !== null) {
    result = result.filter((e) => e.price <= filters.priceMax!);
  }

  if (filters.type) {
    result = result.filter((e) => {
      const species = [e.base_pokemon, e.stage2_pokemon, e.stage3_pokemon].filter(Boolean) as string[];
      return species.some((s) => (typesBySpecies[s] ?? []).includes(filters.type));
    });
  }

  if (filters.killsS2 !== null) {
    result = result.filter((e) => e.kills_to_stage2 === filters.killsS2);
  }
  if (filters.killsS3 !== null) {
    result = result.filter((e) => e.additional_kills_to_stage3 === filters.killsS3);
  }

  if (filters.early !== null) {
    result = result.filter((e) => e.early_rating === filters.early);
  }
  if (filters.mid !== null) {
    result = result.filter((e) => e.mid_rating === filters.mid);
  }
  if (filters.late !== null) {
    result = result.filter((e) => e.late_rating === filters.late);
  }

  if (filters.specialRule) {
    result = result.filter((e) => matchesSpecialRule(e, filters.specialRule as SpecialRuleFilter));
  }

  if (filters.teamRole) {
    result = result.filter((e) => {
      const species = [e.base_pokemon, e.stage2_pokemon, e.stage3_pokemon].filter(Boolean) as string[];
      return species.some((s) =>
        (rolesBySpecies[s] ?? []).some((r) => r.category === filters.teamRole),
      );
    });
  }

  return result;
}

function matchesSpecialRule(entry: PointBuyListEntry, rule: SpecialRuleFilter): boolean {
  switch (rule) {
    case 'has_text':
      return Boolean(entry.special_rules_text?.trim());
    case 'scatterbug':
      return Boolean(entry.special_rules?.scatterbug);
    case 'no_cocoon_rule':
      return Boolean(entry.special_rules?.no_cocoon_rule);
    case 'cosmog':
      return Boolean(entry.special_rules?.cosmog);
    case 'no_redraft':
      return Boolean(entry.special_rules?.no_redraft);
    default: {
      const _exhaustive: never = rule;
      return _exhaustive;
    }
  }
}
