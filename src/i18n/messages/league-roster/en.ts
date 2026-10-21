/**
 * Namespace `league-roster` (owner T05, i18n-core §11.3): the admin roster
 * manager, the substitute dialog, the Core Liga manager and the public Core
 * Liga assignments card.
 *
 * Type names come from the pkmn layer (`localizeType`), never from here.
 */
export default {
  roster: {
    loading: 'Loading roster…',
    heading: 'League Roster ({count})',
    closedArchived: 'This league is archived: its roster can no longer be substituted.',
    closedCompleted: 'This league is completed: its roster can no longer be substituted.',
    empty: 'No participants yet.',
    testBadge: 'Test',
    gymTypeTitle: 'Gym Leader Type',
    noType: 'No Type',
    linkAccount: 'Link account',
    substitute: 'Substitute',
    remove: 'Remove',
    reservesHeading: 'Promoted reserves ({count})',
    reservesHint:
      'Enrolled in a phase by a phase-only substitution, not on the league roster. They can be replaced per phase.',
    addHeading: 'Add players',
    searchLabel: 'Search players',
    searchPlaceholder: 'Type to search…',
    selected: 'Selected ({count})',
    removeAria: 'Remove {name}',
    removeAriaFallback: 'Remove player',
    adding: 'Adding…',
    addCount: { one: 'Add {count} player', other: 'Add {count} players' },
    createGuest: '+ Create guest',
    guestName: 'Guest name',
    guestPlaceholder: 'Display name',
    creating: 'Creating…',
    create: 'Create',
    cancel: 'Cancel',
    errors: {
      loadFailed: 'Failed to load roster data',
      addFailed: 'Failed to add players',
      guestFailed: 'Failed to create guest',
      removeFailed: 'Failed to remove player',
      typeFailed: 'Failed to update type',
      linkFailed: 'Failed to link account',
    },
  },
  substitute: {
    title: 'Substitute {name}',
    replacement: 'Replacement player',
    selectPlayer: 'Select player…',
    guestOption: '{name} (guest)',
    scope: 'Scope',
    scopeLeague: 'Entire league (all active phases)',
    scopePhaseOnly: '{phase} only',
    noScope: '{name} is in no active phase: there is nothing to substitute.',
    phaseOnlyHint: 'Phase-only substitutes keep the league roster unchanged — use this for reserve promotion.',
    previewConfirm: 'Preview & confirm',
  },
  link: {
    title: 'Link account for {name}',
    hint: 'Choose the freshly registered account to merge into this guest. The source account must have no participations, matches, or teams.',
    selectAccount: 'Select registered account…',
    linking: 'Linking…',
    submit: 'Link account',
  },
  dialog: {
    confirmTitle: 'Confirm substitute',
    doneTitle: 'Substitute done',
    replaceLeague:
      'Replace <b>{outName}</b> with <b>{inName}</b> across the entire league. Completed match history stays untouched. The league roster will be updated.',
    replacePhase:
      'Replace <b>{outName}</b> with <b>{inName}</b> across the selected phase. Completed match history stays untouched. The league roster will not change (reserve promotion).',
    replaced: '<b>{inName}</b> replaced <b>{outName}</b>.',
    loadingMatches: 'Loading affected matches…',
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm substitute',
    substituting: 'Substituting…',
    errors: {
      previewFailed: 'Failed to load substitute preview',
      applyFailed: 'Failed to substitute participant',
    },
  },
  preview: {
    rosterSwap: 'League roster swap: <b>{answer}</b>',
    yes: 'Yes',
    no: 'No',
    phaseEnrollments: 'Phase enrollments: <b>{count}</b>',
    noMatches: 'No scheduled matches with zero games need repair.',
    matchesHeading: 'Matches to repair ({count})',
    match: '{player1} vs {player2}',
    nothingToSubstitute: 'Nothing to substitute: no roster row, phase slot or match would change.',
  },
  skipped: {
    heading: {
      one: '{count} planned match was not repaired and stays with the departed player:',
      other: '{count} planned matches were not repaired and stay with the departed player:',
    },
    match: '{tournament}: {player1} vs {player2} ({reason})',
    reason: {
      has_games: 'a result was reported meanwhile',
      changed: 'the match changed meanwhile',
    },
  },
  partial: {
    stopped: 'The substitution stopped partway: the steps before the failure stay written.',
    previewBelow: 'The preview below is what is still open.',
    recheckFailed: 'The check of what is still open failed too; close and reopen the dialog to see it.',
    finish:
      'Confirm it with {name} to finish; another replacement would leave {name} in the slots already handed over.',
    possiblyWithPreview:
      'The substitution may have stopped partway: the request failed before the server could say what it wrote, and a group slot or cancelled match proposals can already be handed over without showing in the preview below. Confirm it with {name} to finish; another replacement could leave {name} holding a group slot without being enrolled.',
    possiblyNoPreview:
      'The substitution may have stopped partway: the request failed before the server could say what it wrote, and a group slot or cancelled match proposals can already be handed over. Confirm it with {name} to finish; another replacement could leave {name} holding a group slot without being enrolled.',
    steps: {
      proposalsCancelled: {
        one: 'Pending proposals cancelled on {count} match',
        other: 'Pending proposals cancelled on {count} matches',
      },
      matchesRepaired: { one: '{count} match re-paired', other: '{count} matches re-paired' },
      groupHandedOver: 'Group slot handed over in {phases}',
      enrollmentMoved: 'Enrollment moved in {phases}',
      rosterSwapped: 'League roster swapped',
      phaseFallback: 'a phase',
    },
  },
  cores: {
    loading: 'Loading cores…',
    poolHeading: {
      one: 'Curated core pool ({count} triple)',
      other: 'Curated core pool ({count} triples)',
    },
    poolHint:
      'Each triple is a possible Core Liga assignment. Manual and bulk assignment both draw from this list only. No two participants will receive the same triple.',
    remove: 'Remove',
    addTriple: '+ Add triple',
    savePool: 'Save pool',
    bulkHeading: 'Bulk random assign',
    forceReroll: 'Force re-roll (overwrites existing cores)',
    rerollAll: 'Re-roll all cores',
    assignMissing: 'Assign cores to participants without one',
    participantsHeading: {
      one: 'Participant cores ({count} participant)',
      other: 'Participant cores ({count} participants)',
    },
    participantsHint:
      'Pick a pool triple for each player, or clear an assignment one at a time. After clearing, the dropdown defaults to the next available pool entry.',
    savePoolFirst: 'Save a core pool before assigning participants.',
    columns: {
      player: 'Player',
      core: 'Core',
      assignedAt: 'Assigned at',
      actions: 'Actions',
    },
    offPool: 'Current core is not in pool — pick a pool triple to fix',
    save: 'Save',
    assign: 'Assign',
    clear: 'Clear',
    info: {
      poolSaved: 'Pool saved',
      assigned: 'Cores assigned: {assigned}; existing kept: {kept}.',
      coreSaved: 'Core saved',
      coreCleared: 'Core cleared',
    },
    errors: {
      loadFailed: 'Failed to load cores',
      poolEmpty: 'Pool must contain at least one triple',
      duplicateTypes: 'Triple {triple} contains duplicate types',
      duplicateTriple: 'Duplicate triple in pool: {triple}',
      selectCore: 'Select a core from the pool',
      requestFailed: 'Failed to save cores',
    },
  },
  participants: {
    heading: 'Core Liga assignments',
  },
} as const;
