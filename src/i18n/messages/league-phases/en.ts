/**
 * Namespace `league-phases` (owner T05, i18n-core §11.3): the admin phase
 * screens — the phase timeline, the phase form and overview editor, the
 * group panel and the group-row repair after substitutions.
 *
 * Status and bracket labels of the timeline come from `enums`; stored group
 * names ("Group A") go through `translateEngineLabel('group', …)`.
 */
export default {
  form: {
    name: 'Phase Name',
    namePlaceholder: 'e.g. Group Stage, Playoffs',
    description: 'Description (optional)',
    bracketType: 'Bracket Type',
    ruleset: 'Ruleset',
    selectRuleset: 'Select a ruleset...',
    bestOf: 'Best of (default)',
    isDoubles: 'Doubles phase',
    isDoublesHint:
      'A new phase follows the selected ruleset until you change this. Shown as a Doubles badge and used for Bring/Lead/Win tracking.',
    teamVisibility: 'Team Visibility',
    advancement: 'Advancement into next phase',
    advancementPlayers: 'players',
    perGroup: 'per group',
    advancementHint: 'Set to 0 for no advancement (final phase). Shown on the prior phase card.',
    submit: 'Save Phase',
    saveFailed: 'Failed to save',
  },
  overview: {
    saved: 'Phase settings saved.',
    saveChanges: 'Save Changes',
  },
  timeline: {
    loading: 'Loading phases...',
    heading: 'Phases ({count})',
    create: '+ Create Phase',
    cancel: 'Cancel',
    empty: 'No phases yet — create the first phase.',
    advancesTop: 'top {count} →',
    advancesTopPerGroup: 'top {count} per group →',
    enrolled: '{count} enrolled',
    rounds: 'Rounds {done}/{total}',
    moveUp: 'Move phase up',
    moveDown: 'Move phase down',
    manage: 'Manage',
    delete: 'Delete',
    confirmDelete: 'Delete phase "{name}"?',
    confirmDeleteWithRounds: 'Delete phase "{name}" and all its rounds/matches? This cannot be undone.',
    newPhaseTitle: 'New Phase — Step 1: Configuration',
    newPhaseHint: 'Participants are enrolled automatically from the league table after creation.',
    createSubmit: 'Create & Enroll Participants',
    errors: {
      loadFailed: 'Failed to load phases',
      deleteFailed: 'Failed to delete phase',
      reorderFailed: 'Failed to reorder phases',
    },
    // The phase delete committed, but the derived-data rebuild after it reported a problem (data.rebuild_warning)
    deletedWithWarning: 'Phase "{name}" was deleted.',
    openDataTools: 'Open admin data tools',
  },
  groups: {
    loading: 'Loading groups...',
    groupCount: 'Group count',
    groupCountOption: { one: '{count} group', other: '{count} groups' },
    serpentine: 'Serpentine assign from seeds',
    clear: 'Clear groups',
    confirmClear: 'Remove all groups and member assignments?',
    empty: 'No groups yet. Seed participants, then serpentine-assign (1→A, 2→B, 3→B, 4→A…).',
    noMembers: 'No members',
    moveAria: 'Move {name}',
    /** A league with groups: its phases mirror the league groups (PHASE_GROUPS_LEAGUE_MANAGED). */
    leagueManaged:
      'This league has groups, so this phase follows them: its groups are built from the league groups when its first round is generated. Change the groups on the league’s <link>Participants</link> tab.',
    /** Grouped round robin with cross-group play: generate-all stops in front of each placement week. */
    placementPause:
      '“Generate All Rounds” stops before each placement week: that week pairs the same-placed trainers of the groups by the tables, so it can only be generated once every earlier match is complete. Generate again then to continue.',
    errors: {
      loadFailed: 'Failed to load groups',
      assignFailed: 'Failed to assign groups',
      clearFailed: 'Failed to clear groups',
      moveFailed: 'Failed to move player',
    },
  },
  repair: {
    title: 'Rows left by substitutions',
    intro:
      'Substitutions made before group rows moved with the slot left the row with the departed player. Check finds those rows and the enrolled substitute who should hold them.',
    rechecked:
      'Checked again after the failure: any row handed over before it stays handed over, and the list below is what is still open.',
    check: 'Check group rows',
    apply: 'Apply repair',
    confirmApply: {
      one: 'Hand {count} group row over to the enrolled substitute? Unresolved items stay as they are.',
      other: 'Hand {count} group rows over to the enrolled substitutes? Unresolved items stay as they are.',
    },
    noGroups: 'This phase has no groups.',
    noMoves: 'No group rows to hand over.',
    movesHeading: 'Rows to hand over ({count})',
    orphanedHeading: 'Rows held by players no longer enrolled ({count})',
    ungroupedHeading: 'Enrolled players without a group ({count})',
    unresolvedNote: 'Unresolved items are left as they are.',
    historyTruncated:
      'Only the newest substitution records were read; rows left by older substitutions were paired from the fixtures alone.',
    fixturesTruncated:
      'Only the oldest {count} matches of this phase were read; pairings from the fixtures may miss newer matches.',
    unreadable: {
      one: '{count} substitution record could not be read and was skipped.',
      other: '{count} substitution records could not be read and were skipped.',
    },
    handedOverNone: 'No group rows needed handing over.',
    handedOver: {
      one: 'Handed over {count} group row:',
      other: 'Handed over {count} group rows:',
    },
    basis: {
      audit: 'substitution log',
      fixtures: 'fixtures',
    },
    rowReason: {
      no_counterpart: 'no substitute traced',
      ambiguous: 'more than one substitute fits',
      several_rows: 'holds rows in several groups',
    },
    playerReason: {
      no_counterpart: 'no departed slot traced',
      ambiguous: 'more than one slot fits',
    },
    errors: {
      checkFailed: 'Failed to check group rows',
      repairFailed: 'Failed to repair group rows',
    },
  },
} as const;
