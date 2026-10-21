/**
 * BRIDGE (owner T03; delete in the sweep). The words of the shared components
 * the league hub embeds (elimination bracket, ruleset detail, the scoped
 * insights tables and their pagination), formerly `DE_SHARED` in
 * `src/lib/league-hub/copy.ts`.
 *
 * i18n-core §7 moves this wording into the owners' namespaces (T06 bracket,
 * T11 ruleset/stats, T01 table pagination, T02 insights) and lets the shared
 * components localize themselves. Until every one of them does (T02 runs in
 * W2), `hubSharedLabels('de')` keeps passing these as the components' existing
 * `labels` overrides so the German hub never shows English chrome. English
 * passes nothing (the components' own defaults); the `en` values below exist
 * for parity only and copy those defaults verbatim.
 */
export default {
  bracket: {
    noRounds: 'No rounds generated yet.',
    tbd: 'TBD',
    match: 'Match',
    tbdMatch: 'TBD match',
    lossesEntering: 'Losses before this match',
  },
  ruleset: {
    doubles: 'Doubles',
    clauses: 'Clauses',
    bannedPokemon: 'Banned Pokémon',
    bannedMoves: 'Banned Moves',
    bannedItems: 'Banned Items',
    bannedAbilities: 'Banned Abilities',
    addedPokemon: 'Added Pokémon',
    sharedType: 'Shared Type Requirement',
    sharedTypeRule: '{percent}% of team must share a type',
    customRules: 'Custom Rules',
  },
  insightsTabs: { usage: 'Pokémon Usage', kills: 'Kill Ranking', moves: 'Move Usage', h2h: 'Head-to-Head' },
  usage: {
    pokemon: 'Pokemon',
    usage: 'Usage%',
    teams: 'Teams',
    efficiency: 'Eff',
    kos: 'KOs',
    koedRate: "KO'd%",
    bringRate: 'Bring%',
    leadRate: 'Lead%',
    winRate: 'Win%',
    empty: 'No Pokemon usage data yet',
  },
  kills: {
    pokemon: 'Pokemon',
    kos: 'KOs',
    koed: "KO'd",
    diff: 'Diff',
    teams: 'Teams',
    brought: 'Brought',
    efficiency: 'Eff',
    empty: 'No kill data yet',
  },
  moves: {
    loading: 'Loading move data...',
    empty: 'No move usage data yet',
    noMatches: 'No moves match the current filters.',
    loadFailed: 'Failed to load move usage data',
    pokemon: 'Pokémon',
    move: 'Move',
    searchPokemon: 'Search Pokémon…',
    searchMoves: 'Search moves…',
    clearFilters: 'Clear filters',
    byPokemon: 'By Pokémon',
    byMove: 'By Move',
    used: 'Used',
  },
  /** Raw templates: `Table` fills `{start}`, `{end}`, `{total}` and `{page}` itself. */
  pagination: {
    showing: 'Showing {start}–{end} of {total}',
    rows: 'Rows',
    rowsPerPage: 'Rows per page',
    pagination: 'Pagination',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    page: 'Page {page}',
  },
} as const;
