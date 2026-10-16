/**
 * `world/client` (T19): the world copy that client components and the pure,
 * client-safe rules helpers read — the anchor nav, the 3D-world switcher, the
 * overlay chrome, the #roster table controls and the `?board=roster` list.
 * Kept small on purpose: it ships in the client chunks of every world page.
 *
 * Section and panel copy rendered on the server lives in `world` and
 * `world/evoliga`. Pokémon names never live here (the pkmn layer).
 */
import { formatPack } from '@/lib/format-pack';

const P = formatPack.messages.en.worldClient;

export default {
  nav: {
    sections: 'Sections',
    evoligaSections: 'EvoLiga sections',
    menu: 'Site navigation',
    /** Registry nav labels, keyed `<worldId>.<sectionId>` (`src/lib/worlds/registry.ts`). */
    worlds: {
      default: { pulse: 'Pulse', phases: 'Phases', reports: 'Reports', stats: 'Stats', rules: 'Rules' },
      evoliga: { pulse: 'Pulse', roster: 'Roster', teams: 'Teams', schedule: 'Schedule', rules: 'Rules' },
      sakura: { pulse: 'Pulse', roster: 'Roster', teams: 'Teams', schedule: 'Schedule', rules: 'Rules' },
      mountain: { pulse: 'Pulse', roster: 'Roster', teams: 'Teams', schedule: 'Schedule', rules: 'Rules' },
      clouds: { pulse: 'Pulse', roster: 'Roster', teams: 'Teams', schedule: 'Schedule', rules: 'Rules' },
    },
  },
  themeSwitcher: {
    auto: 'Auto',
    title: '3D world: {world}',
    ariaLabel: 'Switch 3D world (current: {world})',
  },
  overlay: {
    close: 'Close',
  },
  rosterTable: {
    searchPlaceholder: 'Search Pokémon…',
    searchLabel: 'Search evolution lines',
    priceGroupFilter: 'Filter by price group',
    allPriceGroups: 'All price groups',
    sortLabel: 'Sort table',
    sort: {
      line: 'Line number',
      priceAsc: 'Price ascending',
      priceDesc: 'Price descending',
      kills: 'Kills to stage 2',
    },
    count: '{shown} / {total} lines',
    columns: {
      pokemon: 'Pokémon',
      price: 'Price',
      killsStage2: 'Kills S2',
      killsStage3: 'Kills S3',
      early: 'Early',
      mid: 'Mid',
      late: 'Late',
      group: 'Group',
    },
    openLine: 'Open details for line {name}',
    empty: 'No lines match the current filter.',
    /** Price groups with their price band: the active format pack's labels and ranges. */
    priceGroup: P.rosterTable.priceGroup,
  },
  rosterList: {
    all: 'All',
    filterLabel: 'Filter by band',
    leadLines: {
      one: 'The roster has {count} line — tap it for its details.',
      other: 'All {count} roster lines — tap a line for its details.',
    },
    leadTrainers: {
      one: 'No point-buy list is bound — {count} trainer with their ace and gym band. Tap them for the team.',
      other: 'No point-buy list is bound — all {count} trainers with their ace and gym band. Tap one for the team.',
    },
    shownLines: '{shown} of {total} lines',
    shownTrainers: '{shown} of {total} trainers',
    price: '{price} pts',
    empty: 'The roster is empty so far.',
    filteredEmpty: 'No lines in this band.',
    openLine: 'Open line details for {name}',
    openTeam: 'Open the team of {name}',
  },
  /** The format-aware rules helpers (`src/components/world/sections/rules-context.ts`). */
  rules: {
    formatRow: 'Format',
    bestOfRow: 'Best of',
    modeRow: 'Mode',
    noRuleset: 'no ruleset is assigned to this league.',
    fullRulesWithRuleset: 'Clauses, bans and custom rules for this league are in the league hub.',
    fullRulesWithoutRuleset:
      'No ruleset is assigned to this league, so no clauses, bans or custom rules are on record.',
  },
} as const;
