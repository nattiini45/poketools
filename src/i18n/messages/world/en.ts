/**
 * `world` (T19): the server-rendered copy of the shared league sections
 * (`src/components/world/sections/**`, used by the sakura, mountain and clouds
 * themes), their focus panels, and the DOM-only default world.
 *
 * The plaza's own sections live in `world/evoliga`; the client chrome (nav,
 * switcher, overlay close, roster controls) in `world/client`. League terms
 * (tokens, progress sources) come from `glossary`, enum labels from `enums`,
 * Pokémon names from the pkmn layer — never from here.
 */
export default {
  /** One pairing, word order kept in the message. */
  pairing: '{home} vs {away}',
  noResults: 'No results yet.',
  pulse: {
    heading: 'Pulse',
    kicker: '{place} · League Pulse',
    stageLine: '{stage} · Matchday {round} · {status}',
    stageStatus: { active: 'in progress', upcoming: 'upcoming', completed: 'completed' },
    noStage: 'No stage underway yet.',
    trainers: { one: '{count} trainer', other: '{count} trainers' },
    matchesPlayed: { one: '{count} match played.', other: '{count} matches played.' },
    topOfTable: 'Top of the table',
    fullStandings: 'Full standings in Schedule',
    nowNext: 'Now & next',
    live: 'Live',
    noLive: 'No match in progress.',
    nextKickoff: 'Next kickoff: <b>{home} vs {away}</b> · {time}',
    openDraftRoom: 'Open the draft room',
  },
  roster: {
    heading: 'Roster',
    noList:
      'No point-buy list is bound to this league — the roster shows every trainer’s ace and gym band instead.',
    tilePrice: '{price} pts · {band}',
    tileGym: '{band} gym',
    openBand: 'open',
  },
  teams: {
    heading: 'Teams',
    noTrainers: 'No trainers enrolled yet.',
    evoPoints: '<b>{points}</b> evo pts',
    ace: 'Ace',
    noLines: 'No lines drafted.',
    stage: 'Stage {stage}',
  },
  schedule: {
    heading: 'Schedule',
    upcoming: 'Upcoming — {where}',
    nothingScheduled: 'Nothing scheduled.',
    stageFixtures: '{stage} fixtures',
    latestResults: 'Latest results',
    showingRecent: 'Showing the {shown} most recent of {total} completed matches.',
    fullStandings: 'Full standings',
  },
  standings: {
    caption:
      'League standings: position, trainer, matches won and lost, points, and movement since the previous matchday.',
    trainer: 'Trainer',
    winLoss: 'W–L',
    points: 'Pts',
    move: 'Move',
    noMovement: 'No movement',
    up: { one: 'Up {count} place', other: 'Up {count} places' },
    down: { one: 'Down {count} place', other: 'Down {count} places' },
  },
  rules: {
    heading: 'Rules',
    rulesetOfRecord: 'Ruleset of record',
    format: 'Format',
    fullRules: 'Full rules',
    openRulesTab: 'Open the Rules tab',
    configured: 'Configured for this league',
    leagueDefaults: 'League defaults',
    draft: 'Draft',
    bannedOutright: 'banned outright',
    spiritBody:
      'Lines evolve through real kills and three kinds of token: {draftKill}, {comeback} and {cosmo}. Trades need both trainers’ consent and show as prompts on the league page while pending.',
    defaults: 'Defaults',
    defaultsNote:
      'These values come from the season’s configured format rules; leagues without a row run the standard defaults.',
  },
  board: {
    standingsTitle: 'Standings',
    scheduleTitle: 'Schedule',
    scheduleTitleActive: 'Schedule — {stage}, Matchday {round}',
    liveNow: 'Live now:',
    noCompleted: 'No completed matches yet — the table forms with the first results.',
    matchdayLine: '{stage} · Matchday {round}',
    upcomingFixtures: 'Upcoming fixtures',
    upcoming: 'Upcoming',
    completedFixtures: 'Completed fixtures',
    results: 'Results',
    noResultsYet: 'No results yet — the first matchday has not been played.',
  },
  team: {
    title: 'Team: {name}',
    record: 'Record (W–L–D)',
    points: 'Points',
    rank: 'Rank',
    draftedLines: 'Drafted lines · {points} evolution points',
    stage: 'Stage {stage}',
    price: '{price} pts',
  },
  line: {
    title: 'Line: {name}',
    number: 'No. {number}',
    line: 'Line',
    finalEvolution: 'Final evolution:',
    price: 'Price',
    priceValue: '{price} pts',
    priceGroup: 'Price group',
    killsToStage2: 'Kills to stage 2',
    additionalKills: 'Additional kills to stage 3',
    rating: 'Rating — early / mid / late',
  },
  overlays: {
    rosterLines: 'Roster — every line',
    roster: 'Roster',
    rulebook: 'Rulebook',
  },
  /** The DOM-only fallback world (`src/components/world/default/DefaultWorld.tsx`). */
  defaultWorld: {
    start: 'Start: {date}',
    end: 'End: {date}',
    leagueInsights: 'League insights',
    standings: 'Standings',
    noStandings: 'No standings yet.',
    winLoss: '{wins}W–{losses}L',
    nextUp: 'Next up',
    noScheduled: 'No scheduled matches right now.',
    noPhases: 'No phases configured yet.',
    advancesPerGroup: 'Advances: top {count} per group',
    advancesOverall: 'Advances: top {count} overall',
    noMembers: 'No members',
    noReports: "{name} hasn't filed any reports yet. Reports are generated automatically after each round.",
    unknownPhase: 'Unknown Phase',
  },
} as const;
