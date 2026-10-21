/** `src/components/gamification/**`: achievements chrome, ratings, signatures, streaks. Owned by T02. */
export default {
  achievements: {
    title: 'Achievements',
    empty: 'No achievements available',
    hidden: 'Hidden achievement',
    earnedTooltip: '{description} • Earned {date}',
    timesEarned: '{tier} • x{count}',
    categories: {
      combat: 'combat',
      milestone: 'milestone',
      social: 'social',
      rare: 'rare',
      meta: 'meta',
    },
    tiers: {
      bronze: 'bronze',
      silver: 'silver',
      gold: 'gold',
      platinum: 'platinum',
      legendary: 'legendary',
    },
  },
  rating: {
    provisional: 'Provisional',
    provisionalAria: 'Provisional rating',
    ratingTitle: '{rating} ± {rd}',
    ratingTitleProvisional: '{rating} ± {rd} (provisional)',
  },
  ratingHistory: {
    empty: 'No rating history yet',
    title: 'Rating Trend',
    band: 'Band = ±2×RD',
    chartAria: 'Rating history chart',
  },
  signatures: {
    unlockAt: { one: 'Unlock at {count} game', other: 'Unlock at {count} games' },
    games: { one: '{count} game', other: '{count} games' },
  },
  streaks: {
    win: 'Win Streak',
    ko: 'KO Streak',
    flawless: 'Flawless Streak',
    winValue: '{n}W',
    koValue: '{n}KO',
    flawlessValue: '{n}F',
    recordsTitle: 'Streak Records',
    bestWin: 'Best Win',
    bestLoss: 'Best Loss',
    bestKo: 'Best KO',
    bestFlawless: 'Best Perfect',
  },
} as const;
