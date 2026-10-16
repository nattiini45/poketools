/**
 * Namespace `outbound/discord` (owner T17, i18n-core §6.2): the text of the
 * Discord embeds and the match highlight card. Viewerless: `buildEmbed` and
 * `generateMatchCardImage` translate with the per-webhook language that
 * `emitAsync` resolved (`createTranslator(outboundDiscordMessages, lang)`).
 *
 * Discord markdown (`**bold**`, `||spoiler||`) is part of the copy. Pokémon
 * names, round names and achievement text never live here: they come from the
 * pkmn layer, `translateEngineLabel` and `achievementText`. Draft-tool events
 * use `draft/discord` (owner B-CRON), not this namespace.
 *
 * `en` keeps the pre-i18n English verbatim (the embed tests assert it).
 */
export default {
  watchReplay: 'Watch Replay',
  gameHeader: '**Game {n}:**',
  matchResult: {
    title: 'Game Submitted — {tournament}',
  },
  matchConfirmed: {
    title: 'Match Confirmed — {tournament}',
  },
  matchDisputed: {
    title: 'Match Disputed — {tournament}',
    description:
      '**{disputer}** has disputed the result between **{player1}** and **{player2}**.\nAn admin will need to resolve this.',
  },
  roundGenerated: {
    title: '{round} — {tournament}',
    description: {
      one: 'New round generated with {count} match:',
      other: 'New round generated with {count} matches:',
    },
    pairing: '• {player1} vs {player2}',
  },
  tournamentStarted: {
    title: 'Tournament Started — {tournament}',
    description: '**{tournament}** is now underway!',
  },
  tournamentCompleted: {
    title: 'Tournament Completed — {tournament}',
    description: '**{tournament}** has concluded. Check the site for final standings!',
  },
  seasonAdvanced: {
    title: 'Stage Advancement — {season}',
    description: {
      one: '**{count}** player advanced from **{source}** to **{target}**.',
      other: '**{count}** players advanced from **{source}** to **{target}**.',
    },
  },
  draftPick: {
    title: 'Draft Pick — {season}',
    description: '**{player}** selected **{pokemon}**',
    round: 'Round',
    pickNumber: 'Pick #',
    /** Follows the `<@id>` mention in the message content. */
    upNext: "— you're up next!",
    nextPick: 'Next pick: {name}',
  },
  draftCompleted: {
    title: 'Draft Complete — {season}',
    description: 'The draft is complete ({pool})! All picks have been assigned.',
    /** `{pool}` of a pool with `pool_format`: its turn order and pricing. */
    format: '{order} · {pricing}',
    order: { snake: 'Snake order', linear: 'Same order every round', free: 'Free order' },
    pricing: { none: 'no points', fixed: 'fixed prices', auction: 'auction bids', pointBuy: 'Point Buy' },
  },
  achievementUnlocked: {
    title: 'Achievement Unlocked — {tournament}',
    description: '{icon} **{player}** earned **{achievement}**',
  },
  streakMilestone: {
    title: 'Streak Milestone — {tournament}',
    win: '**{player}** is on a **{count}**-match win streak!',
    ko: '**{player}** is on a **{count}**-match KO streak!',
    flawless: '**{player}** is on a **{count}**-match flawless streak!',
  },
  streakBroken: {
    title: 'Streak Broken — {tournament}',
    description: "**{breaker}** ended **{player}**'s {count}-match streak.",
  },
  ratingMilestone: {
    title: 'Rating Milestone — {tournament}',
    description: '**{player}** reached **{rating}** ({threshold}).',
    threshold: {
      rising_star: 'Rising Star',
      ace_trainer: 'Ace Trainer',
      elite_four: 'Elite Four',
      champion_tier: 'Champion Tier',
    },
  },
  roundCompleted: {
    title: '{round} Completed! — {tournament}',
    results: 'Results',
    standings: 'Standings',
    points: '{points}pts',
    more: '... and {count} more',
  },
  roundRecap: {
    title: 'Round Recap: {round} — {tournament}',
    matchResults: 'Match Results',
    playerSpotlight: 'Player Spotlight: {player}',
    metaTrends: 'Meta Trends',
  },
  roundForecast: {
    title: 'Round Preview: {round} — {tournament}',
    matchupPreviews: 'Matchup Previews',
    boldPrediction: 'Bold Prediction',
  },
  matchCard: {
    confirmed: 'Confirmed',
    winner: 'Winner',
    mvp: 'MVP',
    fainted: 'Fainted',
    kos: {
      one: '{count} KO',
      other: '{count} KOs',
    },
    totalKos: '{count} KOs',
  },
} as const;
