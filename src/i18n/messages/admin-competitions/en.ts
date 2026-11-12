/**
 * Namespace `admin-competitions` (redesign A4): `CompetitionList`, the one list over /admin/leagues,
 * /admin/tournaments, their archived pages and the league trash. The row text that comes from the database or from
 * another namespace (format and status labels, ruleset name, stage counts) arrives already translated from the page.
 */
export default {
  kind: { label: 'Competition type', league: 'Leagues', tournament: 'Tournaments' },
  view: { label: 'Show', active: 'Active', archived: 'Archived', trash: 'Trash' },
  new: { league: 'New league', tournament: 'New tournament' },
  search: {
    label: 'Search competitions',
    placeholder: 'Name, format or ruleset',
    clear: 'Clear search',
  },
  count: {
    league: { one: '{count} league', other: '{count} leagues' },
    tournament: { one: '{count} tournament', other: '{count} tournaments' },
    filtered: '{shown} of {total}',
  },
  caption: { league: 'Leagues', tournament: 'Tournaments' },
  columns: {
    name: 'Name',
    format: 'Format',
    status: 'Status',
    players: 'Players',
    dates: 'Dates',
    nextAction: 'Next action',
  },
  row: {
    test: 'Test',
    archived: 'Archived',
  },
  dates: {
    range: '{start} – {end}',
    from: 'From {date}',
    until: 'Until {date}',
    created: 'Created {date}',
    none: 'Not set',
  },
  /** The next step of a row, by where the competition stands. `actionLabel`: `{action}` + `{name}` for assistive technology. */
  action: {
    setup: 'Set up',
    manage: 'Manage',
    review: 'Review',
    open: 'Open',
  },
  actionLabel: '{action}: {name}',
  empty: {
    league: {
      active: { title: 'No leagues yet', hint: 'Create the first league to start a season.' },
      archived: { title: 'No archived leagues', hint: 'Archive a finished league and it moves here.' },
    },
    tournament: {
      active: { title: 'No tournaments yet', hint: 'Create a standalone tournament for a one-off bracket.' },
      archived: { title: 'No archived tournaments', hint: 'Archive a finished tournament and it moves here.' },
    },
    noMatches: {
      title: 'Nothing matches "{query}"',
      hint: 'Check the spelling or clear the search.',
    },
  },
} as const;
