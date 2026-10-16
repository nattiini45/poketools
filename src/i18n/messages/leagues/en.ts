/**
 * Public league pages outside the hub (owner T03): the league list, the
 * league page's error boundary and fallback links, and the per-league team
 * pages (`src/app/(public)/leagues/**`). English copied verbatim.
 */
export default {
  list: {
    title: 'Leagues',
    empty: 'No leagues yet.',
    stages: { one: '{count} stage', other: '{count} stages' },
  },
  error: {
    title: 'League failed to load',
    description: 'An unexpected error occurred loading this league.',
    goBack: 'Go back',
  },
  detail: {
    pointBuy: 'Point-Buy List',
    matchup: 'Matchup Analysis',
    teams: 'Teams & Progress',
    unknownPlayer: 'Unknown player',
  },
  teams: {
    title: '{league} — Teams',
    registered: { one: '{count} registered team', other: '{count} registered teams' },
    unknownPlayer: 'Unknown Player',
    empty: 'No teams registered yet.',
    hiddenSlot: 'Hidden until this player has completed a match',
    backToLeague: 'Back to league',
  },
  team: {
    title: "{name}'s Team",
    hidden: 'This team is hidden until this player has completed a match.',
    backToTeams: 'Back to teams',
  },
} as const;
