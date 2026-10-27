/**
 * Namespace `format-studio/attach`: the league side of the Format Studio, on a custom league.
 *
 * - `panel.*`: the attach panel of the Format tab (attached summary, picker, buttons, results).
 * - `preview.*`: the list of phases an attach will create, and the parts the engine does not run yet (`gaps.*`).
 * - `blocked.*`: why the Attach button is disabled, in one sentence each.
 * - `readiness.*`: the "Ready to start?" checklist on the overview and the Format tab. Each item has a sentence per
 *   state; `waiting` sentences carry no numbers, because the item depends on a step that is not done yet.
 * - `status.*`: the reason shown under the league status control.
 *
 * Gap sentences name a phase by its name (the preview knows it), an advancement rule by its key.
 */
export default {
  panel: {
    title: 'Format',
    intro: 'A custom league plays the phases of a published format. Attach one and the league gets one phase for each stage.',
    startedNotice: 'This league has started. Its format is locked.',
    attachedHeading: 'Attached format',
    attachedName: 'Format',
    version: 'Version {n}',
    hash: 'Frozen hash',
    copyHash: 'Copy',
    copied: 'Hash copied.',
    copyFailed: 'Copying did not work. The hash is selected: copy it with the keyboard.',
    frozenAt: 'Attached on {date}',
    phases: { one: '{count} phase created', other: '{count} phases created' },
    openPhases: 'Open phases',
    sourceDeleted: 'The source format was deleted. The league keeps its frozen copy.',
    openSource: 'Open source format',
    reattach: 'Re-attach…',
    cancelReattach: 'Keep the current format',
    detach: 'Detach',
    detachTitle: 'Detach this format?',
    detachBody: {
      one: 'Detaching removes the {count} phase created from this format. This only works while no round exists.',
      other: 'Detaching removes the {count} phases created from this format. This only works while no round exists.',
    },
    detachConfirm: 'Detach',
    detached: {
      one: 'Format detached. {count} phase removed.',
      other: 'Format detached. {count} phases removed.',
    },
    reattachTitle: 'Replace the attached format?',
    reattachBody:
      'Re-attaching replaces the current format. Phases that exist in both versions are kept; phases the new version no longer has are removed.',
    reattachConfirm: 'Re-attach',
    pickerLabel: 'Choose a published format',
    pickerPlaceholder: 'Choose a format…',
    group: {
      mine: 'Your formats',
      league: 'Shared with league admins',
      gallery: 'Gallery',
      others: 'Formats of other admins',
    },
    optionLabel: '{name} (version {version}, {owner})',
    ownerYou: 'yours',
    ownerOther: 'another admin',
    ownerGallery: 'gallery',
    capNote: 'Showing the first {count} formats only.',
    emptyTitle: 'No published formats yet',
    emptyBody: 'Publish a format of your own, or use a shared or gallery format, and it shows up here.',
    openStudio: 'Create or browse formats in the Format Studio',
    loadingPreview: 'Loading the phases…',
    previewFailed: 'The format could not be loaded.',
    retry: 'Try again',
    attach: 'Attach',
    reattachSubmit: 'Re-attach',
    attachBusy: 'Working…',
    done: {
      one: 'Format attached. {count} phase created.',
      other: 'Format attached. {count} phases created.',
    },
    createdHeading: 'Phases created',
  },
  preview: {
    heading: 'These phases will be created',
    phase: 'Phase {order}',
    bestOf: 'Best of {n}',
    doubles: 'Doubles',
    rulesetLeague: 'League ruleset',
    rulesetLeagueNamed: 'League ruleset: {name} v{version}',
    rulesetOwn: 'Own ruleset',
    rulesetOwnNamed: 'Ruleset: {name} v{version}',
    rulesetPreset: 'Creates the ruleset {preset}',
    invalid: 'This version cannot be attached: it has errors. Open it in the editor to see them.',
    openFormat: 'Open the format',
    gapsHeading: 'Not run by the engine yet',
    gaps: {
      override_unmapped:
        'Phase “{stage}”: the best-of-{best_of} exception for round {round} cannot be matched to a round of the phase and is ignored.',
      rr_legs_not_run: 'Phase “{stage}”: only one round-robin leg is played ({legs} planned).',
      third_place_not_run: 'Phase “{stage}”: the third-place match is not played.',
      edge_select_not_run:
        'Advancement “{edge}”: the selection “{kind}” is not run. An admin moves the players by hand.',
      groups_not_created: 'Phase “{stage}”: the {count} groups are not created automatically.',
    },
    gapKinds: {
      wildcard: 'wildcards',
      threshold: 'condition',
      bottom_n: 'bottom N',
    },
  },
  blocked: {
    reasonStarted: 'This league has started. Its format is locked.',
    reasonNothing: 'Choose a published format first.',
    reasonLoading: 'The phases are still loading.',
    reasonInvalid: 'This version has errors. Pick another one or fix it in the editor first.',
    reasonRuleset: {
      one: '{count} stage uses the league’s default ruleset, but this league has none. Pick a format that names a ruleset for every stage.',
      other:
        '{count} stages use the league’s default ruleset, but this league has none. Pick a format that names a ruleset for every stage.',
    },
    reasonManual: 'Remove the hand-made phases on the Phases tab first.',
    manualNotice: {
      one: 'This league has {count} hand-made phase. Attaching a format needs a league without them.',
      other: 'This league has {count} hand-made phases. Attaching a format needs a league without them.',
    },
    reasonBusy: 'Working on it…',
  },
  readiness: {
    title: 'Ready to start?',
    intro: 'What a custom league needs before the first round.',
    ready: 'All set. You can start the league.',
    state: {
      met: 'Done',
      unmet: 'To do',
      waiting: 'Waiting for the step above',
    },
    format_attached: {
      met: 'A format is attached.',
      unmet: 'Attach a published format. The league cannot start without one.',
      waiting: 'A format is attached.',
    },
    phases_created: {
      met: 'Phases created from the format: {have} of {need}.',
      unmet: 'Phases created from the format: {have} of {need}.',
      unmetManual: {
        one: 'Phases created from the format: {have} of {need}. The league also has {manual} hand-made phase, which a format cannot replace.',
        other:
          'Phases created from the format: {have} of {need}. The league also has {manual} hand-made phases, which a format cannot replace.',
      },
      waiting: 'The phases are created when a format is attached.',
    },
    roster_size: {
      met: 'Players registered: {have}. The format needs at least {need}.',
      unmet: 'Players registered: {have}. The format needs at least {need}.',
      waiting: 'The number of players needed is known once a format is attached.',
    },
    rulesets: {
      met: 'Every phase has a ruleset.',
      unmet: {
        one: '{count} stage uses the league’s default ruleset, but this league has none. Pick a format that names a ruleset for every stage.',
        other:
          '{count} stages use the league’s default ruleset, but this league has none. Pick a format that names a ruleset for every stage.',
      },
      waiting: 'The rulesets are checked once a format is attached.',
    },
    action: {
      format_attached: 'Attach a format',
      phases_created: 'Open the format',
      phases_manual: 'Open phases',
      roster_size: 'Open participants',
      rulesets: 'Choose another format',
    },
  },
  status: {
    blockedNoFormat: 'Attach a format first. A custom league cannot start without one.',
  },
} as const;
