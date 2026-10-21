/**
 * Namespace `stats` (owner T11, i18n-core §11.3): the usage, kill-ranking,
 * move-usage, standings and head-to-head tables under `src/components/stats/`.
 *
 * The `usage`, `kills` and `moves` groups are the defaults of the tables'
 * `labels` props (`PokemonUsageTableLabels`, `KillRankingTableLabels`,
 * `MoveUsageTableLabels`); keep their keys equal to those interfaces.
 * Pokémon, move and type names never live here: they come from the pkmn layer.
 */
export default {
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
  standings: {
    player: 'Player',
    wins: 'W',
    losses: 'L',
    gameWins: 'Game W',
    gameLosses: 'Game L',
    diff: 'Diff',
    empty: 'No matches completed yet',
  },
  h2h: {
    title: '{player1} vs {player2}',
    matches: { one: '{count} match', other: '{count} matches' },
    games: { one: '{count} game', other: '{count} games' },
    gameRecord: 'Game record: {wins}–{losses}',
    noMatches: 'No matches between these players',
    loadError: 'Could not load head-to-head: {message}',
    loadFailed: 'Failed to load head-to-head matches',
    retry: 'Retry',
    loading: 'Loading...',
  },
} as const;
