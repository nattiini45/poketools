/**
 * Finder filter and view state (draft-frontend §4.4). Client-safe, types and defaults only.
 *
 * State holds ids and keys, never display text (i18n-core §1.7).
 */
import type { LineId, UtilityKey } from '@/types/draft-queue';
import type { PriceTabKey } from '@/lib/draft/price-tabs';
import type { TypeId } from './index-types';

export type { PriceTabKey };
/** How the filters match across a line's stages (FR-6). Also the allowlist of the stored preference. */
export const STAGE_MODES = ['same_stage', 'anywhere'] as const;
export type StageMode = (typeof STAGE_MODES)[number];
/** = `StatKey` of `src/lib/pkmn/i18n/types.ts` (declared here so only `names-port.ts` touches the pkmn layer). */
export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
/** Every sort of the wall, in the order of the select; also the allowlist of the stored preference. */
export const SORT_KEYS = ['default', 'alpha', 'favorites', 'spe', 'atk', 'def', 'spa', 'spd', 'bst'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
/**
 * Which stage of a line a stat reading uses: the line's first stage (`base`) or its last (`final`, stage 3, or
 * stage 2 of a two-stage line). The stat sorts read it from `sortStage`; the team weakness overview from its
 * own `weaknessStage` preference. Also the allowlist of both stored preferences.
 */
export const SORT_STAGES = ['base', 'final'] as const;
export type SortStage = (typeof SORT_STAGES)[number];
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

/**
 * The collapsible groups of the filter sheet, in sheet order. Each filter belongs to exactly one group;
 * `filterGroupCounts` (filter-groups.ts) counts a group's chips.
 */
export type FilterGroupKey = 'pokemon' | 'movesAbilities' | 'stats' | 'utility' | 'defense';
export const FILTER_GROUP_KEYS: readonly FilterGroupKey[] = ['pokemon', 'movesAbilities', 'stats', 'utility', 'defense'];

/** The move and ability search pickers of the sheet. */
export type PickerKey = 'move' | 'ability';

/**
 * UI state of the filter sheet that is not a filter (draft-frontend §5.5). It lives in the view state, not
 * in the sheet, so closing and reopening the sheet keeps it.
 */
export interface FilterSheetState {
  /** Open groups. null = not touched yet: `openFilterGroups` derives them (Pokémon plus every active group). */
  openGroups: FilterGroupKey[] | null;
  /** Utility categories whose members are listed. null = not touched yet: the categories with picked members. */
  utilityExpanded: UtilityKey[] | null;
  /** The relation the defensive type toggles apply to. */
  defenseRelation: DefenseRelation;
  /** The typed queries of the move and ability pickers. */
  pickerQuery: Record<PickerKey, string>;
}

export const INITIAL_FILTER_SHEET: FilterSheetState = {
  openGroups: null,
  utilityExpanded: null,
  defenseRelation: 'resists',
  pickerQuery: { move: '', ability: '' },
};

export interface FinderViewState {
  filters: FinderFilters;
  /** default 'same_stage' (FR-6), persisted */
  stageMode: StageMode;
  /** default 'all' */
  tab: PriceTabKey;
  /** default 'default', persisted */
  sort: SortKey;
  /** The stage whose stats the stat sorts and BST read; default 'final', persisted. */
  sortStage: SortStage;
  /** default true (FR-7), persisted */
  showDrafted: boolean;
  pinnedLineId: LineId | null;
  /** max 3, insertion order */
  compareLineIds: LineId[];
  filterPanelOpen: boolean;
  /** Group, expander and picker state of the filter sheet; survives closing the sheet. */
  filterSheet: FilterSheetState;
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
  prefs?: Partial<Pick<FinderViewState, 'stageMode' | 'sort' | 'sortStage' | 'showDrafted' | 'pinnedLineId'>>,
): FinderViewState {
  return {
    filters: EMPTY_FILTERS,
    stageMode: prefs?.stageMode ?? 'same_stage',
    tab: 'all',
    sort: prefs?.sort ?? 'default',
    sortStage: prefs?.sortStage ?? 'final',
    showDrafted: prefs?.showDrafted ?? true,
    pinnedLineId: prefs?.pinnedLineId ?? null,
    compareLineIds: [],
    filterPanelOpen: false,
    filterSheet: INITIAL_FILTER_SHEET,
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
  | { type: 'setSortStage'; stage: SortStage }
  | { type: 'setShowDrafted'; on: boolean }
  | { type: 'pin'; lineId: LineId | null }
  | { type: 'toggleCompare'; lineId: LineId }
  | { type: 'setFilterPanel'; open: boolean }
  | { type: 'toggleFilterGroup'; group: FilterGroupKey }
  /** Clears the filters of one group (the "count abilities" preference stays, as with `clearAll`). */
  | { type: 'resetFilterGroup'; group: FilterGroupKey }
  | { type: 'toggleUtilityExpanded'; key: UtilityKey }
  | { type: 'setDefenseRelation'; relation: DefenseRelation }
  | { type: 'setPickerQuery'; picker: PickerKey; query: string };
