/**
 * Namespace `admin-assistant` (spec §18.14, plan 5.6): the Admin Assistant's chrome: the drawer, the
 * full page, the conversation list, the composer, the Plan panel and the states around them.
 * The cards (change, build and go-live cards) are in `admin-assistant-cards`; failures are
 * catalogued in `errors/admin-assistant` and rendered with `useApiErrorText`.
 *
 * Separate from the player-facing `agent` namespace (Professor Linden). The staging object is the
 * "Plan" in both languages (in German "Draft" is the Pokémon draft and "Entwurf" a studio draft).
 * Amounts, counts and times arrive as already formatted params (`useFormatter()`); the assistant's
 * own prose and the Pokémon names are never part of this catalog.
 */
export default {
  name: 'Assistant',
  badge: 'AI',

  drawer: {
    open: 'Open assistant',
    close: 'Close assistant',
    title: 'Assistant',
    openFullView: 'Open full view',
    resize: 'Resize assistant',
    shortcutHint: 'Press . to open the assistant, Esc to close it',
  },

  page: {
    title: 'Assistant',
    intro: 'Describe a league, ruleset or tournament in your own words. The assistant prepares a plan and you confirm every change.',
    newConversation: 'New conversation',
    conversations: 'Conversations',
    back: 'Back to conversations',
    untitled: 'New conversation',
    emptyList: 'No conversations yet. Start one to set up a league, a ruleset or a tournament.',
    transcript: 'Conversation',
    planPanel: 'Plan',
  },

  list: {
    updated: 'Updated {time}',
    planProgress: 'Plan {done}/{total}',
    waitingForYou: 'Waiting for you',
    partialBuild: 'Partial build',
    readOnly: 'Read-only',
    delete: 'Delete conversation',
  },

  composer: {
    label: 'Message to the assistant',
    placeholder: 'e.g. A 12-player Gen 9 OU league, double round robin, top 4 playoff, starting next Monday',
    send: 'Send',
    stop: 'Stop',
    continue: 'Continue',
    sending: 'Sending…',
    charsLeft: { one: '{count} character left', other: '{count} characters left' },
    tooLong: 'Too long: shorten the message to {max} characters or fewer.',
    hint: 'Enter to send, Shift+Enter for a new line.',
  },

  transcript: {
    you: 'You',
    assistant: 'Assistant',
    summaryLabel: "Assistant's summary",
    notice: 'The assistant can make mistakes. Check every card before you confirm.',
    working: 'The assistant is working…',
    lookingUp: 'Looking things up…',
    toolDone: 'Done',
    toolFailed: 'Failed',
    jumpToLatest: 'Jump to latest',
    earlier: 'Earlier messages',
  },

  plan: {
    title: 'Plan',
    longTitle: 'Setup plan',
    revision: 'Revision {number}',
    empty: 'The plan fills in as you describe what you want.',
    sections: {
      ruleset: 'Ruleset',
      format: 'Format',
      league: 'League',
      phases: 'Phases',
      roster: 'Roster',
      groups: 'Groups',
      draft: 'Draft',
      tournament: 'Tournament',
      assumptions: 'Assumptions',
      nextSteps: 'Next steps',
    },
    chips: {
      needsInput: 'Needs input',
      assumed: 'Assumed',
      ready: 'Ready',
      blockedSiteAdmin: 'Blocked: site admin needed',
      engineGap: 'Engine gap',
      built: 'Built',
      editedOutside: 'Edited outside chat',
    },
    why: {
      label: 'Why?',
      adminSaid: 'You said so',
      default: 'Default',
      inferred: 'Inferred from what you wrote',
      liveEntity: 'Read from the existing {entity}',
    },
    build: 'Build',
    buildBlocked: 'Build is not possible yet',
    fix: 'Fix',
    edit: 'Edit',
    expand: 'Show plan',
    collapse: 'Hide plan',
  },

  states: {
    loading: 'Loading…',
    empty: 'Nothing here yet.',
    offline: 'The connection was lost. Reload to see where the conversation stands.',
    reconnecting: 'Reconnecting…',
    waitingForConfirm: 'Waiting for your confirmation on the card.',
    readOnlyRole: 'Your role changed, so this conversation is read-only. Start a new conversation.',
    contextFull: 'This conversation is nearly full. Start a new conversation to keep going; the plan is carried over.',
    budgetWarning: 'This conversation has used {spent} of {cap}.',
    budgetStopped: 'This conversation has reached its limit of {cap}.',
    phaseOnly: 'The assistant can only look things up for now; changes are not switched on yet.',
    drift: 'Something changed outside the chat since the assistant last looked.',
    driftRefresh: 'Refresh',
    driftAdapt: 'Ask the assistant to adapt',
  },

  newConversation: {
    title: 'New conversation',
    fromLeague: 'Ask the assistant about this league',
    newLeague: 'New league with assistant',
    describeRuleset: 'Describe a ruleset',
    describeFormat: 'Describe a format',
    fixWithAssistant: 'Fix with assistant',
  },

  errors: {
    generic: 'The assistant could not answer. Please try again.',
    retry: 'Try again',
    loadFailed: 'Could not load the conversation.',
    sendFailed: 'The message could not be sent.',
    notAvailable: 'The assistant is not available.',
  },
} as const;
