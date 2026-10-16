/**
 * The seeded achievement catalog, keyed by `achievement_definitions.key`
 * (i18n-core §5.2). English is the seed text verbatim
 * (the pre-baseline gamification migration, maintainers only).
 * Read through `achievementText(def, locale)`; admin-created achievements
 * without an entry show their DB text. Owned by T02.
 */
export default {
  first_win: { name: 'First Victory', description: 'Win your first match.' },
  ten_wins: { name: 'Double Digits', description: 'Reach 10 total career wins.' },
  fifty_wins: { name: 'Veteran Trainer', description: 'Reach 50 total career wins.' },
  hundred_wins: { name: 'Living Legend', description: 'Reach 100 total career wins.' },
  clean_sweep: { name: 'Clean Sweep', description: 'Record 6 or more KOs in a single match.' },
  flawless: { name: 'Flawless Victory', description: 'Win a match without losing any Pokemon.' },
  giant_killer: { name: 'Giant Killer', description: 'Defeat an opponent seeded at least 4 places above you.' },
  streak_5: { name: 'On Fire', description: 'Reach a 5-match win streak.' },
  streak_10: { name: 'Unstoppable', description: 'Reach a 10-match win streak.' },
  collector_25: { name: 'Pokemon Collector', description: 'Use at least 25 unique Pokemon across your career.' },
  collector_50: { name: 'Pokemon Professor', description: 'Use at least 50 unique Pokemon across your career.' },
  collector_100: { name: 'Living Pokedex', description: 'Use at least 100 unique Pokemon across your career.' },
  iron_wall: { name: 'Iron Wall', description: 'Reach a 3-match flawless streak.' },
  ko_machine: { name: 'KO Machine', description: 'Reach a 5-match KO streak (3+ KOs per match).' },
  tournament_champ: { name: 'Tournament Champion', description: 'Win a tournament final.' },
  back_to_back: { name: 'Back to Back', description: 'Win consecutive tournament finals.' },
} as const;
