/**
 * The readiness checklist of a custom league: what still stands between a league and a first round. Pure and
 * client-safe; the server loader builds the input, the card renders the result.
 *
 * Four items (a fifth, `calendar_start`, for a format whose stage calendar starts with the league), each `met`, `unmet` or
 * `waiting` (it depends on an earlier unmet item, so it cannot be judged yet).
 * An unmet item names where it is fixed (a league admin tab and, for the picker, an anchor). Only an unattached
 * format blocks the Active status, because that is all the API refuses; the other unmet items warn.
 *
 * Nothing here returns text: the card renders item ids and params from its own catalog.
 */
import { dueMarks, roundOpensAt } from '@/lib/format-engine/runtime/calendar';
import { minRosterFor, type FormatDefinition } from '@/lib/format-kit/client';
import type { LeagueAdminTab } from '@/lib/league-admin/tabs';
import type { SeasonFormatType } from '@/types/season';

export type ReadinessItemId = 'format_attached' | 'phases_created' | 'roster_size' | 'rulesets' | 'calendar_start';
export type ReadinessState = 'met' | 'unmet' | 'waiting';

/** Where an unmet item is fixed: a league admin tab, and for the format picker the anchor id on that tab. */
export type ReadinessAction = { tab: LeagueAdminTab; anchor?: string };

export interface ReadinessItem {
  id: ReadinessItemId;
  state: ReadinessState;
  params: Record<string, string | number>;
  action: ReadinessAction | null;
}

export interface ReadinessInput {
  formatType: SeasonFormatType;
  started: boolean;
  participantCount: number;
  seasonRulesetId: string | null;
  /** The frozen copy the league holds, or null when no format is attached. */
  attached: { version_no: number; spec: FormatDefinition } | null;
  /** Phases of the league, hand-made ones included. */
  phaseCount: number;
  /** Phases that were not created from a format. */
  manualPhaseCount: number;
  /**
   * The league's start date (`seasons.start_date`); null when it has none. Left out (undefined), the loader did not read
   * it and the `calendar_start` item is not judged.
   */
  seasonStartDate?: string | null;
  /** The instant "already due" is judged at. Left out, only a missing start date is reported. */
  now?: Date;
}

export interface ReadinessResult {
  /** False for every format type but `custom`. */
  applicable: boolean;
  ready: boolean;
  items: ReadinessItem[];
  blockedReason: 'format_not_attached' | null;
}

/** The id of the format picker on the league's Format tab. */
export const FORMAT_ATTACH_ANCHOR = 'format-attach';

const PICKER: ReadinessAction = { tab: 'format', anchor: FORMAT_ATTACH_ANCHOR };

function item(id: ReadinessItemId, state: ReadinessState, params: Record<string, string | number> = {}, action: ReadinessAction | null = null): ReadinessItem {
  return { id, state, params, action: state === 'unmet' ? action : null };
}

/** Stages that fall back on the league's ruleset (a stored ruleset and a rule preset both name their own). */
function leagueRulesetStages(spec: FormatDefinition): number {
  return spec.stages.filter((stage) => (stage.ruleset?.kind ?? 'season_default') === 'season_default').length;
}

/**
 * The `calendar_start` item of a format with a stage calendar that starts with the league (`start: season_start`), or null
 * when there is none (or the start date was not read). Unmet with `reason: 'missing'` when the league has no readable
 * start date: no round opens and no mark ever fires. Unmet with `reason: 'marks_past'` (`count` marks) when calendar marks
 * are already due before the league started: the cron fires them all in one pass, in calendar order, so a window that
 * opens and closes within that range opens and closes at once. `params.count` is 0 for `missing`, so the card's `zero`
 * plural form carries that sentence.
 */
function calendarStartItem(spec: FormatDefinition, input: ReadinessInput): ReadinessItem | null {
  if (input.seasonStartDate === undefined) return null;
  const calendars = spec.stages.flatMap((stage) => (stage.calendar?.start.kind === 'season_start' ? [stage.calendar] : []));
  if (calendars.length === 0) return null;
  const clock = { seasonStart: input.seasonStartDate };
  const action: ReadinessAction = { tab: 'settings' };
  if (calendars.some((calendar) => roundOpensAt(calendar, 1, clock) === null)) {
    return item('calendar_start', 'unmet', { reason: 'missing', count: 0 }, action);
  }
  if (input.now !== undefined && !input.started) {
    const now = input.now;
    const past = calendars.reduce((sum, calendar) => sum + dueMarks(calendar, clock, now).length, 0);
    if (past > 0) return item('calendar_start', 'unmet', { reason: 'marks_past', count: past }, action);
  }
  return item('calendar_start', 'met');
}

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  if (input.formatType !== 'custom') return { applicable: false, ready: true, items: [], blockedReason: null };

  const { attached } = input;
  const items: ReadinessItem[] = [];
  items.push(item('format_attached', attached !== null ? 'met' : 'unmet', {}, PICKER));

  if (attached === null) {
    items.push(item('phases_created', 'waiting'), item('roster_size', 'waiting'), item('rulesets', 'waiting'));
  } else {
    const need = attached.spec.stages.length;
    const have = Math.max(0, input.phaseCount - input.manualPhaseCount);
    items.push(
      item(
        'phases_created',
        have >= need ? 'met' : 'unmet',
        { have, need, manual: input.manualPhaseCount },
        { tab: input.manualPhaseCount > 0 ? 'phases' : 'format' },
      ),
    );
    const needPlayers = minRosterFor(attached.spec);
    items.push(
      item('roster_size', input.participantCount >= needPlayers ? 'met' : 'unmet', { have: input.participantCount, need: needPlayers }, { tab: 'participants' }),
    );
    const count = leagueRulesetStages(attached.spec);
    items.push(item('rulesets', input.seasonRulesetId !== null || count === 0 ? 'met' : 'unmet', { count }, PICKER));
    const calendar = calendarStartItem(attached.spec, input);
    if (calendar !== null) items.push(calendar);
  }

  return {
    applicable: true,
    ready: items.every((entry) => entry.state === 'met'),
    items,
    blockedReason: attached === null ? 'format_not_attached' : null,
  };
}
