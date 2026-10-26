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
      evoliga: { pulse: 'Pulse', roster: 'Point-Buy list', teams: 'Teams', schedule: 'Schedule', rules: 'Rules' },
      sakura: { pulse: 'Pulse', roster: 'Point-Buy list', teams: 'Teams', schedule: 'Schedule', rules: 'Rules' },
      mountain: { pulse: 'Pulse', roster: 'Point-Buy list', teams: 'Teams', schedule: 'Schedule', rules: 'Rules' },
      clouds: { pulse: 'Pulse', roster: 'Point-Buy list', teams: 'Teams', schedule: 'Schedule', rules: 'Rules' },
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
    /** Heading of the price-group pills under the search and sort controls. */
    priceGroups: 'Price groups',
    allPriceGroups: 'All price groups',
    /** The accessible name of one price-group pill: its label and how many lines it holds. */
    priceGroupPill: {
      one: '{label}: {count} line',
      other: '{label}: {count} lines',
    },
    sortLabel: 'Sort table',
    sort: {
      line: 'Line number',
      priceAsc: 'Price ascending',
      priceDesc: 'Price descending',
      kills: 'KOs to stage 2',
    },
    count: '{shown} / {total} lines',
    columns: {
      pokemon: 'Pokémon',
      price: 'Price',
      killsStage2: 'KOs S2',
      killsStage3: 'KOs S3',
      early: 'Early',
      mid: 'Mid',
      late: 'Late',
      group: 'Group',
    },
    openLine: 'Open details for line {name}',
    empty: 'No lines match the current filter.',
    /** Price groups named by their point range, high to low (the active format pack's labels). */
    priceGroup: P.rosterTable.priceGroup,
  },
  rosterList: {
    all: 'All',
    filterLabel: 'Filter by band',
    leadLines: {
      one: 'The point-buy list has {count} line — tap it for its details.',
      other: 'All {count} lines of the point-buy list — tap a line for its details.',
    },
    leadTrainers: {
      one: 'No point-buy list is bound — {count} trainer with their ace and gym band. Tap them for the team.',
      other: 'No point-buy list is bound — all {count} trainers with their ace and gym band. Tap one for the team.',
    },
    shownLines: '{shown} of {total} lines',
    shownTrainers: '{shown} of {total} trainers',
    price: '{price} pts',
    empty: 'The point-buy list is empty so far.',
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
