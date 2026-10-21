/** Relative and countdown phrasing (i18n-core §1.4). Consumed by `Formatter.duration` and the draft clock. */
export default {
  justNow: 'just now',
  duration: {
    dh: '{d}d {h}h',
    hm: '{h}h {m}m',
    ms: '{m}m {s}s',
    s: '{s}s',
  },
  left: '{duration} left',
  until: 'until {time}',
  hoursLeft: { one: '{count} hour left', other: '{count} hours left' },
  minutesLeft: { one: '{count} minute left', other: '{count} minutes left' },
  leagueTime: '{time} {zone} league time',
  expired: 'Time expired',
} as const;
