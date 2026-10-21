/**
 * Namespace `draft/legacy/league-admin/evolution` (DL-UI-2, draft-frontend §8.5):
 * `EvolutionTierEditor` and `EvolutionPointRecalcButton`.
 * Pokémon names are never written here: examples arrive as `{example}` params from the pkmn layer.
 */
export default {
  tierEditor: {
    loading: 'Loading evolution tiers...',
    title: 'Evolution Tier List',
    cancel: 'Cancel',
    addPokemon: '+ Add Pokémon',
    empty: 'No evolution tiers defined yet. Add Pokémon to enable Evo-League drafting.',
    kos: 'KOs',
    remove: 'Remove',
    addTitle: 'Add Pokémon to Tier List',
    searchBase: 'Search Base Pokémon',
    searchBasePlaceholder: 'Type a Pokémon name (e.g., {example})...',
    threeStageOnly: 'Only 3-stage evolution lines are shown.',
    searching: 'Searching...',
    change: 'Change',
    kosForStage2: 'KOs for Stage 2',
    kosForStage3: 'KOs for Stage 3',
    powerTier: 'Power Tier',
    addToTierList: 'Add to Tier List',
    wildcardTitle: 'Wildcard Assignments',
    wildcardIntro:
      'Bonus Pokémon assigned to specific players (e.g., {example} evolutions). These don’t cost a draft pick.',
    assignWildcardCta: '+ Assign Wildcard',
    unknownPlayer: 'Unknown',
    kosCount: '({count} KOs)',
    noWildcards: 'No wildcards assigned yet.',
    assignWildcard: 'Assign Wildcard',
    player: 'Player',
    selectPlayer: 'Select player...',
    searchPokemon: 'Search Pokémon',
    searchPokemonPlaceholder: 'Type a Pokémon name...',
    summaryLines: {
      one: '<b>{count}</b> evolution line in tier list',
      other: '<b>{count}</b> evolution lines in tier list',
    },
    summaryTier: '<b>{count}</b> {tier}-tier',
    summaryWildcards: {
      one: '<b>{count}</b> wildcard assigned',
      other: '<b>{count}</b> wildcards assigned',
    },
    errors: {
      load: 'Failed to load evolution tiers',
      addTier: 'Failed to add tier',
      addWildcard: 'Failed to add wildcard',
      removeTier: 'Failed to remove tier',
    },
  },
  recalc: {
    cta: 'Recalculate evolution points',
    recalculating: 'Recalculating…',
    done: 'Recalculated {points} across {players}.',
    points: { one: '{count} evolution point', other: '{count} evolution points' },
    players: { one: '{count} player', other: '{count} players' },
    failed: 'Recalculation failed',
  },
} as const;
