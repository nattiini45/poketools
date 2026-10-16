/**
 * Namespace `ruleset` (owner T11, i18n-core §11.3): the ruleset detail and
 * the admin ruleset builder under `src/components/ruleset/`.
 *
 * `detail` holds the defaults of `RulesetDetailLabels` (its function member
 * `sharedTypeRule` is built from `detail.sharedTypeRule`). Pokémon, item and
 * type names are placeholders filled from the pkmn layer; Showdown clause
 * names, format names and tier ids stay English.
 */
export default {
  detail: {
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
    /** A name list's heading with its entry count. */
    headingWithCount: '{heading} ({count})',
  },
  clauses: {
    label: 'Clauses',
  },
  banlist: {
    search: {
      species: 'Search species...',
      moves: 'Search moves...',
      items: 'Search items...',
      abilities: 'Search abilities...',
    },
    searching: 'Searching...',
    remove: 'Remove {name}',
  },
  format: {
    baseFormat: 'Base Format',
    generation: 'Generation',
    custom: 'Custom',
    tier: 'Tier',
    selected: 'Selected: <name>{format}</name>',
    doubles: '(Doubles)',
    customHint: 'Custom format — all fields start blank. Configure clauses and banlists manually.',
  },
  builder: {
    steps: {
      format: 'Format & Name',
      clauses: 'Clauses',
      banlists: 'Banlists',
      constraints: 'Constraints',
      review: 'Review',
    },
    name: 'Ruleset Name',
    namePlaceholder: 'e.g., PLC Season 3 OU',
    doublesToggle: 'Doubles format (enables Bring/Lead/Win tracking)',
    minSharedType: 'Minimum % of team sharing a type',
    sharedTypeOff: 'Disabled — no type restriction',
    sharedTypeMonotype: 'Full monotype',
    sharedTypeExample: 'e.g. {six} of 6, {four} of 4, {three} of 3',
    bannedPokemon: 'Banned Pokémon',
    bannedMoves: 'Banned Moves',
    bannedItems: 'Banned Items',
    bannedAbilities: 'Banned Abilities',
    addedPokemon: 'Added Pokémon (unbanned from base)',
    customRules: 'Custom Rules String (optional)',
    customRulesPlaceholder: 'Raw PS rules overflow...',
    previous: 'Previous',
    next: 'Next',
    update: 'Update Ruleset',
    create: 'Create Ruleset',
    serverError: 'Server error ({status})',
    serverErrorText: 'Server error ({status}): {statusText}',
    saveFailed: 'Failed to save ruleset',
  },
  review: {
    name: 'Name:',
    unnamed: '(unnamed)',
    baseFormat: 'Base Format:',
    doubles: '(doubles)',
    clauses: 'Clauses ({count}):',
    bannedPokemon: 'Banned Pokémon ({count}):',
    bannedMoves: 'Banned Moves ({count}):',
    bannedItems: 'Banned Items ({count}):',
    bannedAbilities: 'Banned Abilities ({count}):',
    addedPokemon: 'Added Pokémon ({count}):',
    sharedType: 'Shared Type Requirement:',
    teamConstraints: 'Team Constraints:',
    customRules: 'Custom Rules:',
    typeQuotaCore: 'Type quota: {min}× per player-core type',
    typeQuotaFixed: 'Type quota: {min}× per fixed type ({types})',
    multiCount: '{rule} (multi-type counts)',
    teraMatch: {
      player_core: 'Tera type must match player core',
      team_types: 'Tera type must match team types',
    },
    nfeOnly: 'NFE-only phase: max {cap} fully-evolved Pokémon',
    nfeOnlyTier: 'NFE-only phase: max {cap} fully-evolved Pokémon (≤ {tier})',
    noLegendaries: '{rule}, no legendaries',
    legendariesBanned: 'Legendaries banned',
    evioliteCap: '{item} cap: blocked on NFEs whose evolution is above {tier}',
  },
  constraints: {
    enable: 'Enable team constraints',
    enableHint:
      'Layer composition rules on top of the base ruleset (type quotas, tera matching, NFE-only phase, {item} tier cap). Used by formats like Core Liga.',
    typeQuotas: 'Type quotas',
    requirePerType: 'Require N Pokémon per assigned type',
    typeSource: 'Type source',
    source: {
      player_core: 'Player core (season draw)',
      fixed: 'Fixed types',
    },
    fixedTypes: 'Fixed types',
    minPerType: 'Min per type',
    multiCount: 'Multi-type Pokémon count toward each of their types ({pokemon} = {type1} + {type2})',
    teraRestriction: 'Tera type restriction',
    teraMatch: {
      none: 'No restriction',
      player_core: 'Must match one of the player’s core types',
      team_types: 'Must match one of the Pokémon’s own types',
    },
    evolutionStage: 'Evolution stage',
    mode: 'Mode',
    modes: {
      unrestricted: 'Unrestricted',
      nfe_only_plus_n_fe: 'NFE only + N exceptions',
    },
    feCap: 'FE cap',
    feTierMax: 'FE tier max',
    noCap: '— no cap —',
    legendariesAllowed: 'Legendaries allowed',
    evioliteCap: '{item} tier cap',
    evioliteHint:
      'NFE species whose evolution sits above this tier cannot hold an {item} (the species itself is still legal).',
  },
} as const;
