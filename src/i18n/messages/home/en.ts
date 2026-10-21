/** Home page (`src/app/(public)/page.tsx`). Owned by T02. */
export default {
  hero: {
    eyebrow: 'Private competitive Pokémon league',
    intro: "Standings, stats, teams, and encyclopedia in one place — the home of your league's whole season.",
    browseTournaments: 'Browse tournaments',
  },
  dividerTitle: "Gotta catch 'em all",
  featured: {
    /** Two keys: the German article differs (Liga / Turnier). */
    league: 'Featured league',
    tournament: 'Featured tournament',
    viewLive: 'View live',
    openInsights: 'Open insights',
    standingsTop3: 'Standings (top 3)',
    record: '{wins}W–{losses}L',
  },
  noActive: 'No active leagues or tournaments right now. Check back soon or browse completed events below.',
  cards: {
    insightsTitle: 'Insights',
    insightsBody: 'Ratings, usage, kill rankings, and streak leaderboards across every scope.',
    wikiTitle: 'Wiki',
    wikiBody: 'Competitive data for Pokémon, moves, items, abilities, and tera types.',
  },
  sections: {
    tournaments: 'Tournaments',
    leagues: 'Leagues',
    viewAll: 'View all',
    noTournaments: 'No tournaments yet.',
    noLeagues: 'No leagues yet.',
  },
} as const;
