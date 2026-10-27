/**
 * Namespace `admin-assistant-cards` (spec §18.6, §18.14, plan 5.4): the chrome of the cards the
 * assistant's transcript shows. Cards are built by code from a stored preview and live data, never
 * by the model, and store keys and structured values only, so a language switch re-renders them.
 * This catalog holds the shared card words: class badges, status chips, action buttons, the
 * acknowledgement and expiry texts, the reversibility badge and the technical-details labels. The
 * per-card field labels are added with each card in the phase that builds it.
 *
 * Targets (league, player, ruleset names) are plain text from the database and never part of a
 * message; Pokémon names come from the pkmn layer; dates, times and numbers arrive formatted.
 */
export default {
  classes: {
    read: 'Lookup',
    preview: 'Preview',
    draft: 'Draft',
    change: 'Change',
    goLive: 'Go live',
  },

  titles: {
    ruleset: 'Ruleset',
    format: 'Format',
    league: 'League',
    phase: 'Phase',
    schedule: 'Schedule',
    roster: 'Roster',
    draft: 'Draft setup',
    tournament: 'Tournament',
    clarification: 'A question',
    capabilityGap: 'Not supported',
    change: 'Proposed change',
    build: 'Build',
    goLive: 'Go live',
    progress: 'Progress',
    undo: 'Undo',
    drift: 'Changed outside the chat',
  },

  status: {
    notExecuted: 'Not executed yet',
    executing: 'Running',
    executed: 'Executed',
    failed: 'Failed',
    unknown: 'Unknown',
    stale: 'Out of date',
    declined: 'Declined',
    expired: 'Expired',
    superseded: 'Replaced by a newer card',
    skipped: 'Skipped',
  },

  actions: {
    approve: 'Confirm',
    decline: 'Decline',
    build: 'Build',
    cancel: 'Cancel',
    resume: 'Resume',
    undo: 'Undo',
    undoSteps: 'Undo these steps',
    openEditor: 'Open in editor',
    accept: 'Accept',
    reject: 'Reject',
    refresh: 'Refresh',
    adapt: 'Ask the assistant to adapt',
    answer: 'Answer',
    skip: 'Skip',
    search: 'Search',
    pick: 'Pick',
    applyFix: 'Apply fix',
    choose: 'Choose',
  },

  build: {
    steps: { one: '{count} step', other: '{count} steps' },
    creates: { one: 'Creates {count} item', other: 'Creates {count} items' },
    visiblePublicly: 'Visible publicly as soon as it is created',
    pinsRuleset: 'Pins {ruleset} version {version}',
    publishesRuleset: 'Makes {ruleset} version {version} publicly readable',
    lockedAfter: 'After this, the bracket type and the ruleset are locked',
    willNotDo: 'This build will not start the league or post anything.',
    engineGapWarning: 'The engine does not cover: {gap}',
  },

  ack: {
    heading: 'Before you confirm',
    visiblePublicly: 'I understand this is visible to everyone at once.',
    outwardEffects: 'I understand this may post to Discord and social channels.',
    typedName: 'Type the name to confirm: {name}',
    typedNameLabel: 'Name',
    required: 'Tick every box to enable Confirm.',
  },

  effects: {
    heading: 'What this sets in motion',
    events: 'Events',
    channels: { one: '{count} matching channel', other: '{count} matching channels' },
    channelsUnknown: 'May post to Discord and social channels; the app cannot tell you which.',
    pairings: 'Pairings with player names',
    contentLanguage: 'Posts are written in {language}',
    aiText: 'An AI forecast or recap may be generated',
  },

  reversibility: {
    undoUntil: 'Undo available until {time}',
    undoAvailable: 'Undo available',
    irreversible: 'Cannot be undone: {reversal}',
    leftAlone: 'Left alone: edited outside the chat',
  },

  expiry: {
    expiresIn: 'Expires in {time}',
    expired: 'Expired',
  },

  details: {
    toggle: 'Technical details',
    method: 'Method',
    path: 'Path',
    body: 'Body',
    planCode: 'Plan code',
    empty: 'None',
  },

  summary: {
    label: "Assistant's summary",
    stepOutcome: 'Step {number}: {title}',
    ledgerId: 'Reference {id}',
    hiddenCharacters: { one: 'Contains {count} hidden character', other: 'Contains {count} hidden characters' },
  },
} as const;
