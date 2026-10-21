/**
 * Namespace `tournaments` (T06): the public tournament list and detail page,
 * its sections/tabs, and Kale Cabbage's round reports. English copies the
 * literals these pages always showed, verbatim. Admin screens live in the
 * sub-namespace `tournaments/admin`.
 */
export default {
  list: {
    title: 'Tournaments',
    empty: 'No tournaments yet.',
    doubles: 'Doubles',
  },
  detail: {
    /** The link back to the league a phase belongs to. */
    backToLeague: 'Back to league: {name}',
    backToLeagueLabel: 'Back to the league {name}',
    insights: 'Insights',
  },
  error: {
    title: 'Tournament failed to load',
    fallback: 'An unexpected error occurred loading this tournament.',
    retry: 'Try again',
    back: 'Go back',
  },
  tabs: {
    rankings: 'Rankings',
    standings: 'Standings',
    bracket: 'Bracket',
    report: "Kale Cabbage's Desk",
    stats: 'Stats',
    rounds: 'Rounds',
    overview: 'Match Overview',
    killRanking: 'Kill Ranking',
    ruleset: 'Ruleset',
    /** The section nav's accessible name. */
    sections: 'Sections',
  },
  roundFilter: {
    label: 'After round:',
    /** `{round}` is the translated "Round 3". */
    latest: '{round} (Latest)',
    active: '{round} (Active)',
  },
  rounds: {
    noMatches: 'No matches',
    versus: 'vs',
    generateForecast: '+ Forecast',
    generateRecap: '+ Recap',
  },
  report: {
    kale: 'Kale Cabbage',
    linden: 'Professor Linden',
    empty: "Kale Cabbage hasn't filed any reports yet.",
    emptyAuto: 'Reports are automatically generated after each round completes.',
    emptyManual: 'Admins can manually generate reports from the Rounds tab.',
    writingRecap: 'Writing up the round...',
    writingForecast: 'Scouting the upcoming matchups...',
    failed: "Kale Cabbage's notebook got rained on. Report unavailable.",
    regenerating: 'Regenerating...',
    retry: 'Retry',
    recap: 'Recap',
    preview: 'Preview',
    regenerate: 'Regenerate Report',
    matchResults: 'Match Results',
    defeated: '{winner} def. {loser}',
    playerSpotlight: 'Player Spotlight',
    spicyPick: 'Spicy Pick',
    usedBy: 'Used by {player}',
    standings: 'Standings:',
    meta: 'Meta:',
    kos: { one: '{count} KO', other: '{count} KOs' },
    viewMatch: 'View match: {player1} vs {player2}',
    lindenMvp: "Professor Linden's MVP",
    mvp: '★ MVP',
    matchupPreviews: 'Matchup Previews',
    matchup: '{player1} vs {player2}',
    edgeWatch: 'Edge: {edge} | Watch: {pokemon}',
    boldPrediction: 'Bold Prediction',
    stakes: 'Stakes:',
  },
} as const;
