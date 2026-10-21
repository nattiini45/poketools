/**
 * Finder view reducer (draft-frontend §4.4). Client-safe, pure.
 *
 * Invariants (unit-tested): `setTab`, `clearAll`, `setSort` and every filter action never change
 * `pinnedLineId` or `compareLineIds` (SPEC:198-199, 363); `toggleCompare` past 3 returns the same state;
 * removing the last picked member of a utility category leaves `members: []` (= the whole category).
 * An action that changes nothing returns the same state object.
 *
 * The filter sheet's UI state (`filterSheet`: open groups, utility expanders, defensive relation, picker
 * queries) changes only through its own actions; `clearAll` and `resetFilterGroup` leave it alone, so the
 * sheet looks the same after a reset.
 */
import type { LineId, UtilityKey } from '@/types/draft-queue';
import { parseChipId } from './chips';
import { expandedUtility, openFilterGroups, resetGroupFilters } from './filter-groups';
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  MAX_COMPARE,
  type DefenseRelation,
  type FilterSheetState,
  type FinderAction,
  type FinderFilters,
  type FinderViewState,
  type FilterGroupKey,
  type StatKey,
} from './filter-types';
import type { TypeId } from './index-types';

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function withFilters(s: FinderViewState, filters: FinderFilters): FinderViewState {
  return filters === s.filters ? s : { ...s, filters };
}

function toggleUtilityCategory(f: FinderFilters, key: UtilityKey): FinderFilters {
  const present = f.utility.some((u) => u.key === key);
  return {
    ...f,
    utility: present ? f.utility.filter((u) => u.key !== key) : [...f.utility, { key, members: [] }],
  };
}

function toggleUtilityMember(f: FinderFilters, key: UtilityKey, id: string): FinderFilters {
  const existing = f.utility.find((u) => u.key === key);
  if (!existing) return { ...f, utility: [...f.utility, { key, members: [id] }] };
  return {
    ...f,
    utility: f.utility.map((u) => (u.key === key ? { key, members: toggle(u.members, id) } : u)),
  };
}

function removeUtilityMember(f: FinderFilters, key: UtilityKey, id: string): FinderFilters {
  const existing = f.utility.find((u) => u.key === key);
  if (!existing || !existing.members.includes(id)) return f;
  return toggleUtilityMember(f, key, id);
}

function setStat(f: FinderFilters, stat: StatKey | 'bst', value: number | null): FinderFilters {
  const stats = { ...f.stats };
  if (value === null || !Number.isFinite(value)) {
    if (!(stat in stats)) return f;
    delete stats[stat];
  } else {
    if (stats[stat] === value) return f;
    stats[stat] = value;
  }
  return { ...f, stats };
}

function setMaxPrice(f: FinderFilters, value: number | null): FinderFilters {
  const next = value === null || !Number.isFinite(value) ? null : value;
  return next === f.maxPrice ? f : { ...f, maxPrice: next };
}

function toggleDefense(f: FinderFilters, relation: DefenseRelation, t: TypeId): FinderFilters {
  const present = f.defense.some((d) => d.relation === relation && d.type === t);
  return {
    ...f,
    defense: present
      ? f.defense.filter((d) => !(d.relation === relation && d.type === t))
      : [...f.defense, { relation, type: t }],
  };
}

function removeChip(f: FinderFilters, chipId: string): FinderFilters {
  const parsed = parseChipId(chipId);
  if (!parsed) return f;
  switch (parsed.kind) {
    case 'type':
      return f.types.ids.includes(parsed.type)
        ? { ...f, types: { ...f.types, ids: f.types.ids.filter((t) => t !== parsed.type) } }
        : f;
    case 'move':
      return f.moves.ids.includes(parsed.id)
        ? { ...f, moves: { ...f.moves, ids: f.moves.ids.filter((m) => m !== parsed.id) } }
        : f;
    case 'ability':
      return f.abilities.ids.includes(parsed.id)
        ? { ...f, abilities: { ids: f.abilities.ids.filter((a) => a !== parsed.id) } }
        : f;
    case 'utility':
      return f.utility.some((u) => u.key === parsed.key)
        ? { ...f, utility: f.utility.filter((u) => u.key !== parsed.key) }
        : f;
    case 'utilityMember':
      return removeUtilityMember(f, parsed.key, parsed.id);
    case 'stat':
      return setStat(f, parsed.stat, null);
    case 'price':
      return setMaxPrice(f, null);
    case 'defense':
      return f.defense.some((d) => d.relation === parsed.relation && d.type === parsed.type)
        ? toggleDefense(f, parsed.relation, parsed.type)
        : f;
  }
}

function withSheet(s: FinderViewState, sheet: FilterSheetState): FinderViewState {
  return sheet === s.filterSheet ? s : { ...s, filterSheet: sheet };
}

function toggleFilterGroup(s: FinderViewState, group: FilterGroupKey): FinderViewState {
  // The first toggle starts from the derived defaults, so it closes an auto-opened group instead of opening it.
  const open = openFilterGroups(s.filterSheet, s.filters);
  return withSheet(s, { ...s.filterSheet, openGroups: toggle(open, group) });
}

function toggleUtilityExpanded(s: FinderViewState, key: UtilityKey): FinderViewState {
  const expanded = expandedUtility(s.filterSheet, s.filters);
  return withSheet(s, { ...s.filterSheet, utilityExpanded: toggle(expanded, key) });
}

function toggleCompare(s: FinderViewState, lineId: LineId): FinderViewState {
  if (s.compareLineIds.includes(lineId)) {
    return { ...s, compareLineIds: s.compareLineIds.filter((id) => id !== lineId) };
  }
  if (s.compareLineIds.length >= MAX_COMPARE) return s;
  return { ...s, compareLineIds: [...s.compareLineIds, lineId] };
}

export function finderReducer(s: FinderViewState, a: FinderAction): FinderViewState {
  const f = s.filters;
  switch (a.type) {
    case 'setText':
      return a.text === f.text ? s : withFilters(s, { ...f, text: a.text });
    case 'toggleType':
      return withFilters(s, { ...f, types: { ...f.types, ids: toggle(f.types.ids, a.id) } });
    case 'setTypeMatch':
      return a.match === f.types.match ? s : withFilters(s, { ...f, types: { ...f.types, match: a.match } });
    case 'toggleMove':
      return withFilters(s, { ...f, moves: { ...f.moves, ids: toggle(f.moves.ids, a.id) } });
    case 'setMoveMatch':
      return a.match === f.moves.match ? s : withFilters(s, { ...f, moves: { ...f.moves, match: a.match } });
    case 'toggleAbility':
      return withFilters(s, { ...f, abilities: { ids: toggle(f.abilities.ids, a.id) } });
    case 'toggleUtilityCategory':
      return withFilters(s, toggleUtilityCategory(f, a.key));
    case 'toggleUtilityMember':
      return withFilters(s, toggleUtilityMember(f, a.key, a.id));
    case 'setStat':
      return withFilters(s, setStat(f, a.stat, a.value));
    case 'setMaxPrice':
      return withFilters(s, setMaxPrice(f, a.value));
    case 'toggleDefense':
      return withFilters(s, toggleDefense(f, a.relation, a.t));
    case 'setAbilityDefense':
      return a.on === f.abilityDefense ? s : withFilters(s, { ...f, abilityDefense: a.on });
    case 'removeChip':
      return withFilters(s, removeChip(f, a.chipId));
    case 'clearAll':
      // Clears every chip and the search text; the "count abilities" switch is a preference, not a chip.
      if (!hasActiveFilters(f) && f.types.match === 'any' && f.moves.match === 'any') return s;
      return withFilters(s, { ...EMPTY_FILTERS, abilityDefense: f.abilityDefense });
    case 'setStageMode':
      return a.mode === s.stageMode ? s : { ...s, stageMode: a.mode };
    case 'setTab':
      return a.tab === s.tab ? s : { ...s, tab: a.tab };
    case 'setSort':
      return a.sort === s.sort ? s : { ...s, sort: a.sort };
    case 'setShowDrafted':
      return a.on === s.showDrafted ? s : { ...s, showDrafted: a.on };
    case 'pin':
      return a.lineId === s.pinnedLineId ? s : { ...s, pinnedLineId: a.lineId };
    case 'toggleCompare':
      return toggleCompare(s, a.lineId);
    case 'setFilterPanel':
      return a.open === s.filterPanelOpen ? s : { ...s, filterPanelOpen: a.open };
    case 'toggleFilterGroup':
      return toggleFilterGroup(s, a.group);
    case 'resetFilterGroup':
      return withFilters(s, resetGroupFilters(f, a.group));
    case 'toggleUtilityExpanded':
      return toggleUtilityExpanded(s, a.key);
    case 'setDefenseRelation':
      return a.relation === s.filterSheet.defenseRelation
        ? s
        : withSheet(s, { ...s.filterSheet, defenseRelation: a.relation });
    case 'setPickerQuery':
      return a.query === s.filterSheet.pickerQuery[a.picker]
        ? s
        : withSheet(s, { ...s.filterSheet, pickerQuery: { ...s.filterSheet.pickerQuery, [a.picker]: a.query } });
  }
}
