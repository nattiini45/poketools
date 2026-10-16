/**
 * Discovery pages: the players directory, the replay library, the creator
 * content page and the replay highlight card. Owned by T02.
 */
export default {
  players: {
    title: 'Players',
    subtitle: 'Browse league competitors',
    searchPlaceholder: 'Search by name…',
    empty: 'No players found.',
    creator: 'Creator',
    unrated: 'Unrated',
    previous: 'Previous',
    next: 'Next',
    pageOf: 'Page {page} of {total}',
  },
  replays: {
    title: 'Replay Library',
    subtitle: 'Spoiler-free public replays from recorded matches.',
    search: 'Search',
    searchPlaceholder: 'Players, Showdown usernames, league, or round',
    league: 'League',
    allLeagues: 'All leagues',
    tournament: 'Tournament',
    allTournaments: 'All tournaments',
    round: 'Round',
    allRounds: 'All rounds',
    startDate: 'Start date',
    endDate: 'End date',
    apply: 'Apply',
    reset: 'Reset',
    empty: 'No replays match the current filters.',
    date: 'Date',
    players: 'Players',
    match: 'Match',
    actions: 'Actions',
    /** The row label; the same shape as the stored search label. */
    rowLabel: '{player1} vs {player2}, {league}, {round}, match {n}',
    gameNumber: 'match {n}',
    matchPage: 'Match page',
    openReplay: 'Open replay',
    unknownPlayer: 'Unknown',
    unknownLeague: 'Unknown league',
    unknownRound: 'Unknown round',
  },
  content: {
    title: 'Content Creator Dashboard',
    subtitle: 'Generate overlay URLs, manage presets, and browse broadcast moments',
    notPlayer: 'Not registered as a player.',
  },
  highlightCard: {
    winner: 'Winner',
    kos: { one: '{count} KO', other: '{count} KOs' },
    clickToSave: 'Click to save',
    dismiss: 'Dismiss',
    exporting: 'Exporting...',
    download: 'Download as PNG',
  },
} as const;
