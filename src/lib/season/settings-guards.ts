import { UserFacingError } from '@/lib/api/user-facing-error';
import type { SeasonFormatType } from '@/types/season';
import { isSeasonStarted, type SeasonStartSignals } from './season-state';

/**
 * Guards for editing a league's settings (PATCH /api/seasons/[id]). Pure and
 * client-safe: the settings form reads the same helpers to disable the league
 * type before the server would refuse it.
 */

/** Why the league type cannot be changed: the league started, or it is on the point-buy side. */
export type FormatLockReason = 'started' | 'point_buy';

export { isSeasonStarted, type SeasonStartSignals } from './season-state';

/**
 * The reason the league type is locked, or null when it can change. The
 * point-buy format comes first: its setup (battle ruleset, format rules, list
 * bind) only runs on creation, so a PATCH can never move a league across that
 * boundary, started or not.
 */
export function formatChangeLock(
  current: SeasonFormatType,
  signals: SeasonStartSignals
): FormatLockReason | null {
  if (current === 'evolution_point_buy') return 'point_buy';
  if (isSeasonStarted(signals)) return 'started';
  return null;
}

/**
 * Whether the league's ruleset can no longer be replaced through the settings form: the league has a ruleset and has started
 * (the same test as `isSeasonStarted`). The server agrees (`assertRulesetChangeAllowed`, error `ruleset_pin_started`): from then
 * on the ruleset only moves to another version of the SAME ruleset, through the pin card and its confirmation. A league
 * without a ruleset can still be given one after it started.
 */
export function isRulesetPinLocked(rulesetId: string | null, signals: SeasonStartSignals): boolean {
  return rulesetId !== null && isSeasonStarted(signals);
}

/** The league types a settings form offers for a league currently of type `current`. */
export function editableFormatTypes(current: SeasonFormatType): readonly SeasonFormatType[] {
  if (current === 'evolution_point_buy') return ['evolution_point_buy'];
  return ['singles', 'doubles', 'draft'];
}

/**
 * Throws when switching the league type from `current` to `next` is not
 * allowed. Resending the stored type is always fine (a settings form sends the
 * whole object), even once the league has started.
 */
export function assertFormatChangeAllowed(
  current: SeasonFormatType,
  next: SeasonFormatType,
  signals: SeasonStartSignals
): void {
  if (next === current) return;
  if (current === 'evolution_point_buy' || next === 'evolution_point_buy') {
    throw new UserFacingError(
      'A point-buy league keeps its league type, and other leagues cannot be switched to it',
      { code: 'SEASON_FORMAT_POINT_BUY_LOCKED', status: 409 }
    );
  }
  if (isSeasonStarted(signals)) {
    throw new UserFacingError('The league type cannot be changed once the league has started', {
      code: 'SEASON_FORMAT_LOCKED',
      status: 409,
    });
  }
}

/** Whether the end date is on or after the start date; true when either is empty. */
export function isSeasonDateRangeValid(start?: string | null, end?: string | null): boolean {
  if (!start || !end) return true;
  // ISO calendar dates (YYYY-MM-DD) order the same as strings.
  return end >= start;
}

export function assertSeasonDateRange(start?: string | null, end?: string | null): void {
  if (!isSeasonDateRangeValid(start, end)) {
    throw new UserFacingError('The end date must not be before the start date', {
      code: 'SEASON_DATES_INVALID',
      status: 400,
    });
  }
}
