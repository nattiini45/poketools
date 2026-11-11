/**
 * Public league pages outside the hub (owner T03): the league list, the
 * league page's error boundary and fallback links, and the per-league team
 * pages (`src/app/(public)/leagues/**`). English copied verbatim.
 */
export default {
  list: {
    title: 'Leagues',
    empty: 'No leagues yet.',
    /** The status link tabs over the list. */
    filterLabel: 'Filter by status',
    filters: { all: 'All', active: 'Active', upcoming: 'Upcoming', completed: 'Finished' },
    emptyFiltered: 'No leagues with this status.',
    showAll: 'Show all leagues',
    dateRange: '{start} – {end}',
    dateFrom: 'From {start}',
    stages: { one: '{count} stage', other: '{count} stages' },
    /** Badge on a test league (`is_test_season`) wherever leagues are listed. */
    testBadge: 'Test league',
  },
  error: {
    title: 'League failed to load',
    description: 'An unexpected error occurred loading this league.',
    goBack: 'Go back',
  },
  /** The league hero (versus screen) at the top of a league page. */
  hero: {
    statusMatchday: '{status} · Matchday {matchday}',
    /** One line of world lore; the only place the site chrome carries it (D9). */
    lore: {
      evoliga: 'Plaza world. The east terrace still waits for its champion.',
      sakura: 'Sakura Park. Every result goes up on the banner row under the torii.',
      mountain: 'Mountain Pass. Results are painted on the trail signs up to the pass gate.',
      clouds: 'Skyisle. The fixtures drift past on the airship, the halo gate keeps the rules.',
    },
    stats: {
      trainers: { one: 'trainer', other: 'trainers' },
      matchesPlayed: { one: 'match played', other: 'matches played' },
      daysLeft: { one: 'day left', other: 'days left' },
      daysToStart: { one: 'day to the start', other: 'days to the start' },
    },
    match: { yours: 'Your next match', live: 'Live now', next: 'Next match' },
    leader: { leading: 'Top of the table', champion: 'Champion' },
    /** A trainer's place and points under their name plate. */
    standing: '#{rank} · {points} pts',
    vs: 'VS',
    actions: { submit: 'Submit result', prep: 'Match prep', open: 'Open match' },
  },
  detail: {
    pointBuy: 'Point-Buy List',
    matchup: 'Matchup Analysis',
    teams: 'Teams & Progress',
  },
  teams: {
    title: '{league} — Teams',
    registered: { one: '{count} registered team', other: '{count} registered teams' },
    unknownPlayer: 'Unknown Player',
    empty: 'No teams registered yet.',
    hiddenSlot: 'Hidden until a match played with this team is completed',
    backToLeague: 'Back to league',
  },
  team: {
    title: "{name}'s Team",
    hidden: 'This team is hidden until a match played with it is completed.',
    backToTeams: 'Back to teams',
  },
} as const;
