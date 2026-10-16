/**
 * `/insights`, its tabs, the shared `ScopedInsightsView` and the ratings
 * leaderboard. Owned by T02. The tables' own words live in `stats` (T11).
 */
export default {
  page: {
    title: 'Insights',
    globalTitle: 'Global Insights',
    scopeNotFound: 'Scope not found.',
    loading: 'Loading insights…',
    subtitle: 'Insights & statistics',
  },
  tabs: {
    ratings: 'Ratings',
    usage: 'Pokémon Usage',
    kills: 'Kill Ranking',
    moves: 'Move Usage',
    h2h: 'Head-to-Head',
    streaks: 'Streaks',
  },
  ratingsGlobalNote:
    'Player ratings are global. Switch scope to Global to change league/tournament filters for other tabs.',
  h2h: {
    player1: 'Player 1',
    player2: 'Player 2',
    selectPlayer: 'Select player',
    versus: 'vs',
    prompt: 'Select two players to view head-to-head stats',
  },
  streaks: {
    empty: 'No streak data yet.',
    winStreak: 'Win streak: {current} (best {best})',
  },
  standings: 'Standings',
  scope: {
    global: 'Global (all time)',
    league: 'League',
    tournament: 'Tournament',
  },
  leaderboard: {
    title: 'Global Ratings',
    minGames: 'Min games',
    loading: 'Loading leaderboard...',
    empty: 'No rated players yet.',
    player: 'Player',
    rating: 'Rating',
    peak: 'Peak',
    record: 'Record',
    signatures: 'Signatures',
    recordValue: '{wins}-{losses}-{draws}',
  },
} as const;
