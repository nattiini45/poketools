/**
 * Date math for the `resolve_date` tool (plan 3.6.1): "next Monday" computed by the server in the admin's time zone, so
 * the model never works out a weekday itself.
 *
 * All arithmetic is on calendar dates (year, month, day) in UTC after the zone has been applied once to `now`, so a
 * DST change cannot move a result by a day.
 */
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface ResolveDateInput {
  anchor: 'today' | 'tomorrow' | 'in_days' | 'weekday';
  days?: number;
  weekday?: Weekday;
  relation?: 'upcoming' | 'this' | 'next';
}

export interface ResolvedDate {
  time_zone: string;
  today: string;
  today_weekday: Weekday;
  date: string | null;
  weekday: Weekday | null;
  candidates: string[];
  ambiguous: boolean;
  in_past: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date `now` has in `timeZone`, as a UTC midnight timestamp. An unknown zone falls back to Europe/Berlin. */
function localDate(now: Date, timeZone: string): { utcMidnight: number; zone: string } {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(pick('year'), pick('month') - 1, pick('day'));
  };
  try {
    return { utcMidnight: read(timeZone), zone: timeZone };
  } catch {
    return { utcMidnight: read('Europe/Berlin'), zone: 'Europe/Berlin' };
  }
}

const iso = (utcMidnight: number): string => new Date(utcMidnight).toISOString().slice(0, 10);

/** Monday = 0 ... Sunday = 6. */
const weekdayIndex = (utcMidnight: number): number => (new Date(utcMidnight).getUTCDay() + 6) % 7;

export function resolveRelativeDate(input: ResolveDateInput, now: Date, timeZone: string): ResolvedDate {
  const { utcMidnight: today, zone } = localDate(now, timeZone);
  const todayIndex = weekdayIndex(today);
  const base = { time_zone: zone, today: iso(today), today_weekday: WEEKDAYS[todayIndex] };
  const single = (at: number): ResolvedDate => ({
    ...base,
    date: iso(at),
    weekday: WEEKDAYS[weekdayIndex(at)],
    candidates: [iso(at)],
    ambiguous: false,
    in_past: at < today,
  });

  switch (input.anchor) {
    case 'today':
      return single(today);
    case 'tomorrow':
      return single(today + DAY_MS);
    case 'in_days':
      return single(today + (input.days ?? 0) * DAY_MS);
    case 'weekday': {
      const target = WEEKDAYS.indexOf(input.weekday ?? 'monday');
      const relation = input.relation ?? 'upcoming';
      if (relation === 'this') return single(today + (target - todayIndex) * DAY_MS);
      // First such weekday strictly after today.
      const ahead = ((target - todayIndex + 6) % 7) + 1;
      const after = today + ahead * DAY_MS;
      if (relation === 'next' && target === todayIndex) {
        // "next Monday" said on a Monday: today or a week from now. The model asks.
        return { ...base, date: null, weekday: WEEKDAYS[target], candidates: [iso(today), iso(after)], ambiguous: true, in_past: false };
      }
      return single(after);
    }
  }
}
