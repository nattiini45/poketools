/**
 * Namespace `match` (T07): the public match page, the highlight card, game
 * cards, game list, move lists and the image buttons. Forms live in
 * `match/forms`, the Professor Linden AI cards in `match/ai`.
 * Pokémon, move and item names never appear here: they come from the pkmn layer.
 */
export default {
  /** "{p1} vs {p2}" page subtitles. */
  versusTitle: '{p1} vs {p2}',
  detail: {
    title: 'Match Detail',
    evolutionSummary: 'Evolution League Summary',
    evolutionProgress: '{name} — Evolution Progress',
    notBrought: 'Not brought ({count})',
    planTeam: 'Plan Team',
    submitResult: 'Submit Result',
    confirmResult: 'Confirm Result',
    games: 'Games',
    noGames: 'No games played yet.',
    notes: 'Notes',
    backToTournament: 'Back to tournament',
  },
  shared: {
    kos: { one: '{count} KO', other: '{count} KOs' },
    games: { one: '{count} game', other: '{count} games' },
    koed: "KO'd",
    lead: 'Lead',
    game: 'Game {n}',
    vs: 'vs',
    mvpBadge: '★ MVP',
    profName: 'Professor Linden',
    unknownPlayer: 'Unknown player',
  },
  card: {
    overview: 'Overview',
    matchView: 'Match view',
    recordWl: '{w}W-{l}L',
    recordWld: '{w}W-{l}L-{d}D',
    turnsShort: '{n}t',
    notUsed: 'Not used in battle',
    winner: 'Winner',
    loser: 'Loser',
    noStreak: 'No current streak',
    profMvp: "Professor Linden's MVP",
    profTurningPoint: "Professor Linden's Turning Point",
    highlights: 'Match Highlights',
    mvpLine: '★ MVP: {name}',
    mvpSummary: '{kos} across {games}',
    totalKos: 'Total KOs: {p1} {k1} · {p2} {k2}',
    noTeamData: 'No team data available for this match',
  },
  gameCard: {
    notBrought: 'Not brought',
    turnsActive: { one: '{count} turn active', other: '{count} turns active' },
    winnerLabel: 'Winner:',
    sourceReplay: 'Replay',
    sourceManual: 'Manual',
    manuallyEdited: 'Manually edited',
    viewReplay: 'View Replay ↗',
    edit: 'Edit',
    noStats: 'No detailed stats available for this game.',
  },
  gameList: {
    gameShort: 'G{n}',
    wins: '{name} wins',
    pending: 'Pending',
    replay: 'Replay',
  },
  moves: {
    showMore: { one: 'Show {count} more move', other: 'Show {count} more moves' },
  },
  exportCard: {
    title: 'Export as PNG',
    exporting: 'Exporting…',
    save: 'Save as image',
  },
  socialImage: {
    capturing: 'Capturing…',
    uploading: 'Uploading…',
    uploaded: 'Uploaded!',
    failed: 'Failed',
    update: 'Update Social Image',
    create: 'Create Social Image',
    titleUpdate: 'Re-capture and update the social image',
    titleCreate: 'Capture match card for social posts',
  },
} as const;
