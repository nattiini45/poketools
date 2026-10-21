/**
 * Namespace `broadcast-overlays` (T14): OBS overlay text. Overlays render in
 * the overlay language (`resolveOverlayLocale`), never the viewer cookie.
 * Pokémon names come from the pkmn layer, not from here.
 */
export default {
  common: {
    vs: 'VS',
    vsLower: 'vs',
    winner: 'Winner',
    bestOf: 'Best of {count}',
    record: '{wins}W-{losses}L',
    winsShort: 'W',
    lossesShort: 'L',
    unknownPlayer: 'Unknown',
    myTeam: 'My Team',
    me: 'Me',
    opponent: 'Opponent',
    game: 'Game {n}',
    gameWinner: '{name} wins Game {n}',
    alive: '{count} alive',
    kos: { one: '{count} KO', other: '{count} KOs' },
    games: { one: '{count} game', other: '{count} games' },
    winRate: '{rate} WR',
    mvpBadge: '★ MVP',
    draw: 'Draw',
    league: 'League',
  },
  streak: {
    win: { one: '{count} Win Streak', other: '{count} Win Streak' },
    flawless: { one: '{count} Flawless', other: '{count} Flawless' },
    ko: { one: '{count} KO Streak', other: '{count} KO Streak' },
  },
  moment: {
    turning_point: 'Turning Point',
    big_ko: 'Big KO',
    misplay: 'Misplay',
    clutch: 'Clutch',
    highlight: 'Highlight',
    turn: 'Turn {n}',
  },
  statCard: {
    turns: '{count}t',
    notUsed: 'Not used',
    lead: 'Lead',
    koed: "KO'd",
  },
  matchCard: {
    mvp: { one: 'MVP: {pokemon} ({count} KO, {player})', other: 'MVP: {pokemon} ({count} KOs, {player})' },
  },
  rating: {
    peak: 'Peak',
    peakValue: '(Peak: {rating})',
  },
  score: {
    series: 'Series {p1}-{p2}',
  },
  reel: {
    empty: 'No moments recorded',
    title: 'Match Highlights · {current}/{total}',
  },
  standings: {
    title: 'Standings',
    points: '{points}pts',
    tickerEntry: '#{rank} {name} {wins}-{losses}',
    tickerEntryWithPokemon: '#{rank} {name} {wins}-{losses} ({pokemon})',
  },
  preview: {
    h2h: 'Head-to-Head: {p1}-{p2}',
    leads: '{name} leads',
    even: 'Even',
  },
  results: {
    reveal: 'Click to reveal results',
    notCompleted: 'Match not yet completed',
  },
  story: {
    matchMvp: 'Match MVP',
  },
  teams: {
    title: 'Team Comparison',
  },
  usage: {
    title: 'Pokemon Usage',
  },
  h2h: {
    title: 'Head-to-Head',
    matches: { one: '{count} match', other: '{count} matches' },
    firstMeeting: 'First Meeting',
    history: 'Match History',
  },
  spotlight: {
    signature: 'Signature Pokemon',
  },
  leaders: {
    title: 'Season Leaders',
    mostKos: 'Most KOs',
    pokemonMvp: 'Pokemon MVP',
    bestRecord: 'Best Record',
    kosValue: '{pokemon} ({kos})',
    winRateValue: '{pokemon} ({rate} WR)',
    recordValue: '{name} ({wins}-{losses})',
    none: 'No leader data yet',
    notEnough: 'Not enough data for season leaders yet',
  },
  attract: {
    tagline: 'Competitive Pokémon League',
    currentStandings: 'Current Standings',
    inProgress: 'Matches in progress',
    recentResults: 'Recent Results',
  },
  recap: {
    title: '{round} Recap',
    roundFallback: 'Round {n}',
    matchOfRound: 'Match of the Round',
    results: "This Round's Results",
    movement: 'Standings Movement',
    noMovement: 'No major standings changes this round',
    story: 'Season Story',
    noStory: 'Round recap narrative will appear here',
  },
  wiki: {
    power: 'Power',
    accuracy: 'Accuracy',
    pp: 'PP',
    priority: 'Priority',
    teraType: 'Tera Type',
  },
} as const;
