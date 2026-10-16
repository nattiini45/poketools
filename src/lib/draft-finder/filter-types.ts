/**
 * Finder filter and view state (draft-frontend §4.4). Client-safe, types and defaults only.
 *
 * State holds ids and keys, never display text (i18n-core §1.7).
 */
import type { LineId, UtilityKey } from '@/types/draft-queue';
import type { PriceTabKey } from '@/lib/draft/price-tabs';
import type { TypeId } from './index-types';

export type { PriceTabKey };
export type StageMode = 'same_stage' | 'anywhere';
/** = `StatKey` of `src/lib/pkmn/i18n/types.ts` (declared here so only `names-port.ts` touches the pkmn layer). */
export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type SortKey = 'default' | 'alpha' | 'favorites' | 'spe' | 'atk' | 'def' | 'spa' | 'spd' | 'bst';
export type DefenseRelation = 'resists' | 'immune' | 'weak';

/** Stat order of `StatTuple` (index-types.ts). */
export const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export interface FinderFilters {
  text: string;
  types: { ids: TypeId[]; match: 'any' | 'all' };
  /** pkmn move ids */
  moves: { ids: string[]; match: 'any' | 'all' };
  /** OR */
  abilities: { ids: string[] };
  /** members = move/ability ids; [] = whole category */
  utility: { key: UtilityKey; members: string[] }[];
  /** >= threshold */
  stats: Partial<Record<StatKey | 'bst', number>>;
  maxPrice: number | null;
  defense: { relation: DefenseRelation; type: TypeId }[];
  /** default true (product decision) */
  abilityDefense: boolean;
}

export interface FinderViewState {
  filters: FinderFilters;
  /** default 'same_stage' (FR-6), persisted */
  stageMode: StageMode;
  /** default 'all' */
  tab: PriceTabKey;
  /** default 'default', persisted */
  sort: SortKey;
  /** default true (FR-7), persisted */
  showDrafted: boolean;
  pinnedLineId: LineId | null;
  /** max 3, insertion order */
  compareLineIds: LineId[];
  filterPanelOpen: boolean;
}

export const MAX_COMPARE = 3;

/** The cleared filter set. Shared: the reducer never mutates state, it copies. */
export const EMPTY_FILTERS: FinderFilters = {
  text: '',
  types: { ids: [], match: 'any' },
  moves: { ids: [], match: 'any' },
  abilities: { ids: [] },
  utility: [],
  stats: {},
  maxPrice: null,
  defense: [],
  abilityDefense: true,
};

/** The default view; `prefs` are the persisted per-viewer preferences and the session's pinned line. */
export function initialFinderState(
  prefs?: Partial<Pick<FinderViewState, 'stageMode' | 'sort' | 'showDrafted' | 'pinnedLineId'>>,
): FinderViewState {
  return {
    filters: EMPTY_FILTERS,
    stageMode: prefs?.stageMode ?? 'same_stage',
    tab: 'all',
    sort: prefs?.sort ?? 'default',
    showDrafted: prefs?.showDrafted ?? true,
    pinnedLineId: prefs?.pinnedLineId ?? null,
    compareLineIds: [],
    filterPanelOpen: false,
  };
}

/** True when any filter that narrows the wall is set (text, types, moves, abilities, utility, stats, price, defense). */
export function hasActiveFilters(f: FinderFilters): boolean {
  return (
    f.text.trim().length > 0 ||
    f.types.ids.length > 0 ||
    f.moves.ids.length > 0 ||
    f.abilities.ids.length > 0 ||
    f.utility.length > 0 ||
    Object.keys(f.stats).length > 0 ||
    f.maxPrice !== null ||
    f.defense.length > 0
  );
}

export type FinderAction =
  | { type: 'setText'; text: string }
  | { type: 'toggleType'; id: TypeId }
  | { type: 'setTypeMatch'; match: 'any' | 'all' }
  | { type: 'toggleMove'; id: string }
  | { type: 'setMoveMatch'; match: 'any' | 'all' }
  | { type: 'toggleAbility'; id: string }
  | { type: 'toggleUtilityCategory'; key: UtilityKey }
  | { type: 'toggleUtilityMember'; key: UtilityKey; id: string }
  | { type: 'setStat'; stat: StatKey | 'bst'; value: number | null }
  | { type: 'setMaxPrice'; value: number | null }
  | { type: 'toggleDefense'; relation: DefenseRelation; t: TypeId }
  | { type: 'setAbilityDefense'; on: boolean }
  | { type: 'removeChip'; chipId: string }
  | { type: 'clearAll' }
  | { type: 'setStageMode'; mode: StageMode }
  | { type: 'setTab'; tab: PriceTabKey }
  | { type: 'setSort'; sort: SortKey }
  | { type: 'setShowDrafted'; on: boolean }
  | { type: 'pin'; lineId: LineId | null }
  | { type: 'toggleCompare'; lineId: LineId }
  | { type: 'setFilterPanel'; open: boolean };
