/**
 * Namespace `ui` (owner T01, i18n-core §11.3): the shared UI atoms in
 * `src/components/ui` and the generic shared widgets in
 * `src/components/shared` (avatar, pickers, admin helpers). Components that
 * take a `labels` prop keep it as an optional override; these are the
 * defaults. English values are the literals these files have always shown.
 */
export default {
  /** `Table` / `TablePagination` chrome (the `TablePaginationLabels` defaults). */
  table: {
    showing: 'Showing {start}–{end} of {total}',
    rows: 'Rows',
    rowsPerPage: 'Rows per page',
    pagination: 'Pagination',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    page: 'Page {page}',
  },
  combobox: {
    clear: 'Clear',
    searching: 'Searching…',
    noResultsFor: 'No results for “{query}”',
  },
  modal: {
    close: 'Close',
    /** Screen-reader title of a modal opened without one. */
    untitled: 'Dialog',
  },
  confirmDialog: {
    cancel: 'Cancel',
    confirm: 'Confirm',
  },
  spinner: {
    label: 'Loading',
    /** The visible line under the ball; `{label}` is the spinner's label. */
    visible: '{label}…',
  },
  palette: {
    legend: 'Color scheme',
    triggerWithPalette: 'Color scheme: {palette}',
    /** Keyed by `SitePaletteId`. */
    options: {
      plaza: { label: 'Plaza', description: 'Warm sand · default' },
      sakura: { label: 'Sakura Park', description: 'Blossom and plum' },
      mountain: { label: 'Mountain Pass', description: 'Meadow and spruce' },
      clouds: { label: 'Skyisle', description: 'Cloud and slate' },
    },
  },
  avatar: {
    alt: "{name}'s avatar",
  },
  categoryIcon: {
    unknown: 'Unknown category',
    /** `{category}` is the localized move category (pkmn layer). */
    alt: '{category} move',
  },
  pokemonAutocomplete: {
    placeholder: 'Pokémon name',
    searching: 'Searching...',
    noResults: 'No results',
  },
  scope: {
    label: 'Scope',
    globalOnly: 'Ratings are global only',
    global: 'Global (all time)',
    league: 'League',
    tournament: 'Tournament',
  },
  resourceAdmins: {
    loading: 'Loading admins...',
    none: 'No resource admins assigned.',
    remove: 'Remove',
    searchPlaceholder: 'Search a registered player...',
    alreadyAdmin: 'already an admin',
    add: 'Add Admin',
    /** `{reason}` is the API's refusal, in the viewer's language. */
    addFailed: 'Could not add the admin: {reason}',
    removeFailed: 'Could not remove the admin: {reason}',
    loadFailed: 'Could not load the admins: {reason}',
  },
  archive: {
    archive: 'Archive',
    unarchive: 'Unarchive',
    busy: '...',
    confirmArchive: {
      season: 'Archive this league? It will be hidden from public listings.',
      tournament: 'Archive this tournament? It will be hidden from public listings.',
    },
    confirmUnarchive: {
      season: 'Unarchive this league? It will reappear in public listings.',
      tournament: 'Unarchive this tournament? It will reappear in public listings.',
    },
    failed: 'Failed to update',
  },
  deleteResource: {
    label: 'Delete',
    confirm: {
      // `{days}` = LEAGUE_TRASH_RETENTION_DAYS: the league moves to the trash instead of vanishing.
      season: 'Delete league "{name}"? It moves to the trash; the superadmin can restore it for {days} days.',
      tournament: 'Delete tournament "{name}"? This removes it and its dependent records. This cannot be undone.',
    },
    failed: {
      season: 'Failed to delete league',
      tournament: 'Failed to delete tournament',
    },
    // The delete committed; the derived-data rebuild after it reported a problem ({warning}: the catalogued text of data.rebuild_warning)
    deletedWithWarning: {
      season: 'League "{name}" was moved to the trash. {warning}',
      tournament: 'Tournament "{name}" was deleted. {warning}',
    },
  },
  description: {
    empty: 'No description yet. Add one to help Professor Linden understand league-specific rules.',
    edit: 'Edit description',
    add: 'Add description',
    placeholder:
      'Describe special rules, type locks, constraints, etc. This is fed to Professor Linden for match analysis.',
    save: 'Save',
    cancel: 'Cancel',
    failed: 'Failed to save',
    /** An unsaved draft from an earlier visit (kept in this browser tab) is waiting. */
    draftFound: 'You have an unsaved description draft.',
    resumeDraft: 'Resume editing',
    discardDraft: 'Discard draft',
    /** The browser refused to store the draft (private mode, blocked or full storage). */
    draftNotKept: 'This browser cannot keep an unsaved draft: save before you leave this page.',
  },
} as const;
