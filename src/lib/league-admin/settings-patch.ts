/**
 * The save payload of the league details form (Settings tab): only the fields the admin changed.
 *
 * `PATCH /api/seasons/[id]` guards what the form must not send, so the form leaves it out instead of
 * relying on the refusal: the league type once the league started (or across the point-buy boundary),
 * and the battle ruleset of a point-buy league (the create form sends `ruleset_id: null` for one, which
 * would wipe the pack's ruleset the server set on creation).
 *
 * Pure and client-safe: no reads, no React.
 */
import type { SeasonFormatType } from '@/types/season';
import type { FormatLockReason } from '@/lib/season/settings-guards';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';

/** The form's field values, as the inputs hold them (empty string = unset). */
export interface LeagueSettingsValues {
  name: string;
  formatType: SeasonFormatType;
  rulesetId: string;
  startDate: string;
  endDate: string;
}

export type LeagueSettingsPatch = Partial<{
  name: string;
  format_type: SeasonFormatType;
  ruleset_id: string | null;
  start_date: string | null;
  end_date: string | null;
}>;

/** The changed fields of `current` against `initial`; `{}` when nothing changed. */
export function buildLeagueSettingsPatch(
  initial: LeagueSettingsValues,
  current: LeagueSettingsValues,
  formatLock: FormatLockReason | null,
): LeagueSettingsPatch {
  const patch: LeagueSettingsPatch = {};
  const pointBuy = isEvolutionPointBuy(initial.formatType) || isEvolutionPointBuy(current.formatType);

  const name = current.name.trim();
  if (name !== initial.name.trim()) patch.name = name;
  if (current.formatType !== initial.formatType && formatLock === null && !pointBuy) {
    patch.format_type = current.formatType;
  }
  if (current.rulesetId !== initial.rulesetId && !pointBuy) patch.ruleset_id = current.rulesetId || null;
  if (current.startDate !== initial.startDate) patch.start_date = current.startDate || null;
  if (current.endDate !== initial.endDate) patch.end_date = current.endDate || null;

  return patch;
}
