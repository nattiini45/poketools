/**
 * League-level threshold overrides on top of the imported point-buy list
 * (draft-backend §2.2, BR-2, critique B19). Client-safe. The overrides are the
 * active format pack's `epb.lineOverrides` (`@/lib/format-pack`).
 *
 * The list rows stay exactly as imported; `getListEntries` and the other read
 * paths of `src/lib/supabase/queries/point-buy-lists.ts` pass every row through
 * `applyLeagueOverrides`, so thresholds, the match pipeline, the catalog and the
 * snapshot all see the overridden values. The layer holds THRESHOLDS ONLY:
 * Participation tokens and the redraft lock read the stored flags `special_rules.cosmog`
 * / `special_rules.no_redraft` that the importer sets, so SQL and TS cannot
 * disagree. The importer's reconciliation report lists every override it would
 * apply against the sheet values, on every run.
 */

import { lineIdOfEntry, type LineId, type LineKeyedEntry } from '@/lib/draft/line-identity';
import { formatPack, lineOverrideFor, type LineOverride } from '@/lib/format-pack';

export type OverrideField = 'kills_to_stage2' | 'additional_kills_to_stage3';

export type { LineOverride };

export interface AppliedOverride {
  field: OverrideField;
  sheet_value: number | null;
  applied_value: number;
  reason: { en: string; de: string };
}

/**
 * The minimum an entry needs for the override layer: its line id (stored, or
 * computed from the stage names, so any `PointBuyListEntry` qualifies) and the
 * two thresholds.
 */
export type OverridableEntry = LineKeyedEntry & {
  kills_to_stage2: number;
  additional_kills_to_stage3: number | null;
};

/** The league's threshold overrides: the active format pack's `epb.lineOverrides`. */
export const LEAGUE_LINE_OVERRIDES: readonly LineOverride[] = formatPack.epb.lineOverrides;

const OVERRIDE_FIELDS: readonly OverrideField[] = ['kills_to_stage2', 'additional_kills_to_stage3'];

export function overrideFor(lineId: LineId): LineOverride | null {
  return lineOverrideFor(lineId);
}

/**
 * The fields the override for `entry.line_id` would change, with the sheet value
 * and the applied value. A field whose sheet value already equals the override
 * is not listed.
 */
export function overridesFor(entry: OverridableEntry): AppliedOverride[] {
  const override = overrideFor(lineIdOfEntry(entry));
  if (!override) return [];
  const applied: AppliedOverride[] = [];
  for (const field of OVERRIDE_FIELDS) {
    const value = override[field];
    if (value === undefined) continue;
    const sheetValue = entry[field];
    if (sheetValue === value) continue;
    applied.push({ field, sheet_value: sheetValue, applied_value: value, reason: override.reason });
  }
  return applied;
}

/**
 * A copy of `entry` with the league overrides applied, its `line_id` set (computed
 * from the stage names when the entry had none) and `overrides` listing what
 * changed (`[]` when nothing did). Flags and every other field are untouched.
 * Idempotent: an entry that already passed this layer (it carries `overrides`)
 * keeps that record, so re-applying never loses the sheet values.
 */
export function applyLeagueOverrides<T extends OverridableEntry & { overrides?: AppliedOverride[] }>(
  entry: T,
): T & { line_id: LineId; overrides: AppliedOverride[] } {
  const line_id = lineIdOfEntry(entry);
  if (entry.overrides !== undefined) {
    return { ...entry, line_id, overrides: entry.overrides } as T & { line_id: LineId; overrides: AppliedOverride[] };
  }
  const overrides = overridesFor(entry);
  const patch: Partial<Record<OverrideField, number>> = {};
  for (const o of overrides) patch[o.field] = o.applied_value;
  // Only line_id and the two numeric threshold fields change, so T's shape holds.
  return { ...entry, ...patch, line_id, overrides } as T & { line_id: LineId; overrides: AppliedOverride[] };
}
