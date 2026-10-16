/**
 * Namespace `league-admin` (owner T04, i18n-core §11.3): the league setup
 * screens (list, archive, create form, phase page) and the setup controls
 * (status, theme, test flag, format rules). The season page's own strings
 * live in `league-admin/season-page` (DF7b).
 *
 * League terms (tokens, budget, stages, evolution points) come from
 * `glossary`; status, format, bracket and tera-rule labels from `enums`.
 */
export default {
  list: {
    title: 'Manage Leagues',
    viewArchived: 'View Archived',
    newLeague: '+ New League',
    empty: 'No leagues yet.',
    stages: { one: '{count} stage', other: '{count} stages' },
    testBadge: 'Test',
  },
  archived: {
    title: 'Archived Leagues',
    back: 'Back to Leagues',
    empty: 'No archived leagues.',
    badge: 'Archived',
  },
  create: {
    title: 'Create League',
  },
  form: {
    name: 'League Name',
    namePlaceholder: 'e.g. PLC Season 5',
    description: 'Description (optional)',
    descriptionPlaceholder:
      'e.g. Each participant is locked to 60% of a given type. Describe type assignments, special rules, etc.',
    formatType: 'Format Type',
    worldTheme: '3D World Theme',
    ruleset: 'Ruleset (optional)',
    noRuleset: 'No default ruleset',
    contentLanguage: 'Content language (Discord, reports, overlays)',
    contentLanguageHint:
      'The language of text nobody reads on this site: Discord posts, stored AI reports and stream overlays. Visitors always see their own language.',
    startDate: 'Start Date',
    endDate: 'End Date',
    submit: 'Create League',
    saveFailed: 'Failed to save',
  },
  theme: {
    label: 'Theme',
    auto: 'Auto (format default)',
    saving: 'Saving…',
    saveFailed: 'Failed to update theme',
  },
  status: {
    label: 'Status:',
    saveFailed: 'Failed to update status',
  },
  testFlag: {
    label: 'Test league — excluded from public lists and all-time stats',
    hint: 'The league stays reachable by its own link. Games recorded before the flag was set stay in the all-time stats.',
    saving: 'Saving…',
    saveFailed: 'Failed to update the test-league flag',
  },
  formatRules: {
    loading: 'Loading format rules...',
    loadFailed: 'Failed to load format rules',
    empty: 'No format rules configured yet. Initialize with default Evolution Point Buy rules?',
    initialize: 'Initialize Default Rules',
    initializing: 'Initializing...',
    initializeFailed: 'Failed to initialize format rules',
    saved: 'Format rules saved.',
    picks: 'Picks',
    /** `{token}` = glossary `token.draftKill`. */
    tokenRatio: '{token} ratio',
    /** `{token}` = glossary `token.draftKill`. */
    tokenMax: '{token} limit',
    ratioValue: '{ratio}:1',
    bannedMoves: 'Banned Moves',
    bannedItems: 'Banned Items',
    teraRules: 'Tera Rules',
    /** `{stage}` = glossary roster stage, `{rule}` = enums `teraRule`. */
    teraRule: '{stage}: {rule}',
    tiebreakerOrder: 'Tiebreaker Order',
    tiebreaker: {
      match_points: 'Match points',
      kill_difference: 'Kill difference',
      head_to_head: 'Head to head',
      decision_match: 'Decision match',
    },
  },
  phasePage: {
    subtitle: '{league} · Phase {order} · {bracket} · {bestOf} · {status}',
    back: '← Back to {name}',
    newPhaseHint:
      'Step 2: Participants are enrolled from the league table. Adjust seeds if needed, then generate the bracket below.',
    overview: 'Overview',
    description: 'Description',
    participants: 'Participants',
    groups: 'Groups',
    rounds: 'Rounds',
  },
} as const;
