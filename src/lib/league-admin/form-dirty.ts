/**
 * When does a league admin form hold input that is not saved yet? The answer drives
 * `unsavedMarker(dirty)` (`./unsaved.ts`), which `UnsavedTabGuard` reads before a tab switch.
 *
 * One pure predicate per form, so the rule is testable without a DOM: `PhaseForm`,
 * `DraftTierLimitsEditor`, `DraftPoolEditor` and `LeagueSettingsForm` (src/components/league/)
 * compute their `dirty` flag here and nowhere else.
 *
 * Pure and client-safe: no reads, no React.
 */
import type { LeagueSettingsValues } from './settings-patch';

/** The editable values of `PhaseForm` (the fields the admin can change). */
export interface PhaseFormValues {
  name: string;
  description: string;
  bracketType: string;
  rulesetId: string;
  bestOf: number;
  /** Per-round best-of overrides; a value of 0 or less means "no override" (the form drops it on save). */
  boOverrides: Readonly<Record<string, number>>;
  teamVisibility: string;
  advCount: number;
  advPerGroup: boolean;
}

/** The overrides the form would actually save: positive values only, in key order. */
function effectiveOverrides(overrides: Readonly<Record<string, number>>): string {
  return Object.entries(overrides)
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

/**
 * `PhaseForm` is dirty when a field differs from the values it last loaded or saved
 * (`initialData` on mount, the submitted values after a successful save). An override set to 0
 * equals no override, because the form drops it on save.
 */
export function phaseFormDirty(baseline: PhaseFormValues, current: PhaseFormValues): boolean {
  return (
    baseline.name !== current.name ||
    baseline.description !== current.description ||
    baseline.bracketType !== current.bracketType ||
    baseline.rulesetId !== current.rulesetId ||
    baseline.bestOf !== current.bestOf ||
    baseline.teamVisibility !== current.teamVisibility ||
    baseline.advCount !== current.advCount ||
    baseline.advPerGroup !== current.advPerGroup ||
    effectiveOverrides(baseline.boOverrides) !== effectiveOverrides(current.boOverrides)
  );
}

/**
 * `DraftTierLimitsEditor` is dirty while a tier limit differs from the limits it last loaded or
 * saved. Tiers missing on one side count as 0 (unlimited), as the API stores them.
 */
export function tierLimitsDirty(
  baseline: Readonly<Record<string, number>>,
  current: Readonly<Record<string, number>>,
): boolean {
  const tiers = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  for (const tier of tiers) {
    if ((baseline[tier] ?? 0) !== (current[tier] ?? 0)) return true;
  }
  return false;
}

/** The parts of `DraftPoolEditor` that hold typed or chosen input before a write. */
export interface PoolEditorInput {
  /** The add form is open. Its fields only count while it is. */
  addFormOpen: boolean;
  /** Text in the add form's search box. */
  searchQuery: string;
  /** A Pokémon chosen in the add form, not added yet. */
  selectedPokemon: string | null;
  /** A point cost typed in the add form ('' = none). */
  addCost: number | '';
  /** A template name typed in the template panel, not saved yet. */
  templateName: string;
}

/**
 * `DraftPoolEditor` is dirty while the open add form has a search, a chosen Pokémon or a cost
 * entered, or a template name is typed. Inline row edits save on change, so they never count.
 */
export function poolEditorDirty(input: PoolEditorInput): boolean {
  const addFormInput =
    input.addFormOpen &&
    (input.searchQuery.trim() !== '' || input.selectedPokemon != null || input.addCost !== '');
  return addFormInput || input.templateName.trim() !== '';
}

/**
 * `LeagueSettingsForm` is dirty while a field differs from the values it last loaded or saved.
 * The name compares trimmed, because the save sends it trimmed.
 */
export function leagueSettingsDirty(baseline: LeagueSettingsValues, current: LeagueSettingsValues): boolean {
  return (
    baseline.name.trim() !== current.name.trim() ||
    baseline.formatType !== current.formatType ||
    baseline.rulesetId !== current.rulesetId ||
    baseline.startDate !== current.startDate ||
    baseline.endDate !== current.endDate
  );
}

/** What `LeagueSettingsForm` keeps between renders: the stored values it last saw, its baseline and the input. */
export interface LeagueSettingsFormState {
  /** The stored values (the `initial` prop) the form last took over. */
  seen: LeagueSettingsValues;
  baseline: LeagueSettingsValues;
  values: LeagueSettingsValues;
}

function sameLeagueSettings(a: LeagueSettingsValues, b: LeagueSettingsValues): boolean {
  return (
    a.name === b.name &&
    a.formatType === b.formatType &&
    a.rulesetId === b.rulesetId &&
    a.startDate === b.startDate &&
    a.endDate === b.endDate
  );
}

/**
 * The form state after the stored values arrive (`initial`, new after `router.refresh()`). Equal
 * values change nothing and return `state` itself, so a refresh triggered elsewhere on the page never
 * touches typed input. Different values become the baseline; the input follows them unless the admin
 * has unsaved edits, which stay. The form is not remounted, so its "saved" notice and the focus survive.
 */
export function adoptStoredLeagueSettings(
  state: LeagueSettingsFormState,
  stored: LeagueSettingsValues,
): LeagueSettingsFormState {
  if (sameLeagueSettings(state.seen, stored)) return state;
  return {
    seen: stored,
    baseline: stored,
    values: leagueSettingsDirty(state.baseline, state.values) ? state.values : stored,
  };
}
