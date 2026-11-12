/**
 * The public team library, a library entry and a shared team link
 * (`src/app/(public)/teams/**`). Owned by T02. The Showdown paste itself
 * stays English (it is import/export text).
 */
export default {
  library: {
    title: 'Team Library',
    subtitle: 'Published teams from across the league — search, browse, fork.',
    searchPlaceholder: 'Search teams…',
    shinySort: 'Shiny sort: {mode}',
    sortModes: {
      latest: 'Latest first',
      nameAsc: 'Name A→Z',
      nameDesc: 'Name Z→A',
    },
    loading: 'Loading…',
    empty: 'No teams published yet.',
    previous: 'Previous',
    next: 'Next',
    range: '{from}–{to} of {total}',
    untitled: 'Untitled Team',
    published: 'Published {date}',
    emptyHint: 'Build a team and publish it from the teambuilder to see it here.',
    openTeambuilder: 'Open the teambuilder',
    emptySearch: 'No teams match your search.',
    emptySearchHint: 'Try another name or tag, or clear the search to see every team.',
    clearSearch: 'Clear search',
  },
  entry: {
    loading: 'Loading…',
    metaDescription: 'A team published to the library: {species}.',
    fork: 'Fork This Team',
    forking: 'Forking…',
  },
  shared: {
    loading: 'Loading team…',
    rateLimitedTitle: 'Too many requests',
    rateLimited: {
      one: 'This link was opened too often from your connection. Try again in {count} second.',
      other: 'This link was opened too often from your connection. Try again in {count} seconds.',
    },
    metaDescription: 'A shared team: {species}.',
    defaultTitle: 'Shared Team',
    tournament: 'Tournament',
    showdownPaste: 'Showdown Paste',
    copyPaste: 'Copy Paste',
  },
  set: {
    slot: 'Slot {n}',
    item: '@ {item}',
    ability: 'Ability: <value>{ability}</value>',
    tera: 'Tera:',
    nature: '{nature} Nature',
    ivs: 'IVs: {spread}',
    roster: 'Team roster',
    moves: 'Moves',
  },
} as const;
