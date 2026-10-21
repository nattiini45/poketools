/**
 * `draft/finder` (draft-frontend §10.3, owner DF2b): the roster wall, the finder bar, the filter panel,
 * the active-filter chips, the price tabs and the hover details.
 *
 * - League terms (utility category names, "Filters", "All", "Show drafted", "Compare") come from
 *   `glossary`; draftability reasons from `draft/shared.reasons`; Pokémon names from `src/lib/pkmn/i18n`.
 * - Sentence case in storage; ALL-CAPS only through CSS.
 * - `card.*` and `wall.keyboardHint` live here (not in `draft/screen`) because the wall and its cards are
 *   DF2b's files.
 */
export default {
  search: {
    label: 'Search Pokémon lines',
    placeholder: 'Search any stage (EN/DE)',
  },
  mode: {
    label: 'Where the filters must match',
    same: 'On the same Pokémon',
    anywhere: 'Anywhere in the line',
  },
  filters: {
    panelLabel: 'Filter Pokémon lines',
    description: 'Filters apply right away. Groups with active filters are open.',
    close: 'Close filters',
    /** The Filters button with the number of active filters; `{label}` = glossary `state.filters`. */
    button: '{label} ({count})',
    type: 'Type',
    move: 'Moves',
    ability: 'Abilities',
    stats: 'Base stats',
    maxPrice: 'Maximum price (points)',
    utility: 'Utility',
    loading: 'Filters are loading',
    groups: {
      pokemon: 'Pokémon',
      movesAbilities: 'Moves and abilities',
      stats: 'Base stats',
      utility: 'Utility',
      defense: 'Defensive matchups',
    },
    groupActive: { one: '{count} active', other: '{count} active' },
    resetGroup: 'Reset',
    resetGroupLabel: 'Reset {group}',
    showLines: { one: 'Show {count} line', other: 'Show {count} lines' },
  },
  match: {
    label: 'Match',
    any: 'Any',
    all: 'Require all',
  },
  picker: {
    moveSearch: 'Search moves (EN/DE)',
    abilitySearch: 'Search abilities (EN/DE)',
    selected: 'Selected',
    noResults: 'No results',
    remove: 'Remove {name}',
    moreResults: { one: '{count} more – keep typing', other: '{count} more – keep typing' },
  },
  stats: {
    minLabel: '{stat}: at least',
    placeholder: 'any',
  },
  price: {
    any: 'Any price',
    upTo: 'Up to {n} P',
    sliderLabel: 'Maximum price in points',
    reset: 'Reset',
    hint: 'Hides lines that cost more. The price tabs above the lines pick a price range.',
  },
  defense: {
    resists: 'resists {type}',
    immune: 'immune to {type}',
    weak: 'weak to {type}',
    relationLabel: 'Defensive relation',
    relation: {
      resists: 'Resists',
      immune: 'Immune',
      weak: 'Weak',
    },
    typesLabel: 'Attacking types',
    abilities: 'Count abilities',
    abilitiesHint: 'Abilities that grant an immunity or halve the damage count too.',
    weakTypingOnly: 'Weaknesses count the typing only.',
    viaAbility: 'with ability {ability}',
  },
  utility: {
    banned: 'banned',
    /** `{move}` = the localized name of Rest (pkmn layer). */
    restNote: '{move} counts only when picked on its own.',
    showMembers: 'Show the moves and abilities of {category}',
    hideMembers: 'Hide the moves and abilities of {category}',
    wholeCategory: 'Any of them',
  },
  chips: {
    label: 'Active filters',
    price: '≤{n} P',
    stat: '{stat} ≥ {n}',
    utilityMember: '{category}: {member}',
    remove: 'Remove filter: {label}',
    clearAll: 'Clear all filters',
    none: 'No filters',
    count: { one: '{count} line', other: '{count} lines' },
  },
  sort: {
    label: 'Sort',
    default: 'Default (price)',
    alpha: 'Alphabetical',
    favorites: 'Favourites first',
    stat: '{stat} (final stage)',
    bst: 'BST',
  },
  tabs: {
    label: 'Price range',
    range: '{max}–{min}',
    matchingOfTotal: '{matching}/{total}',
    tabAria: {
      one: '{range} points, {count} line',
      other: '{range} points, {count} lines',
    },
  },
  wall: {
    label: 'Pokémon lines',
    keyboardHint: 'Arrow keys move · Enter selects · F favourite · C compare',
  },
  card: {
    aria: '{line}, {price} points, {state}',
    available: 'available',
    drafted: 'drafted by {player}',
    draftedUnknown: 'drafted',
    mine: 'yours',
    blocked: 'not draftable: {reason}',
    branchTag: '→ {stage3}',
    favoriteAdd: 'Add {line} to favourites',
    favoriteRemove: 'Remove {line} from favourites',
    inCompare: 'in comparison',
  },
  hover: {
    title: 'Why this line matches',
    met: '{criterion} ✓',
    missed: '{criterion} ✕',
    via: '{what}, from Stage {stage}',
    fromStage: 'from Stage {stage}',
    allAtOnce: 'All at once – from Stage {stage}',
    notTogether: 'Not all on the same Pokémon',
    typing: 'typing ×{multiplier}',
    statValue: '{stat} {value}',
    specialRule: 'Special rule',
    utilityTitle: 'Utility matches',
    utilityMatch: '{category}: {what}, from Stage {stage}',
  },
  empty: 'No line matches your filters.',
  loadingIndex: 'Loading filters…',
} as const;
