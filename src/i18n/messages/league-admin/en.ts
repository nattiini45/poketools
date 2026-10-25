/**
 * Namespace `league-admin` (owner T04, i18n-core §11.3): the league setup
 * screens (list, archive, create form, phase page) and the setup controls
 * (status, theme, test flag, format rules). The season page's own strings
 * live in `league-admin/season-page` (DF7b).
 *
 * League terms (tokens, budget, stages, evolution points) come from
 * `glossary`; status, format, bracket and tera-rule labels from `enums`.
 */
import { formatPack } from '@/lib/format-pack';

/** The point-buy league type's own wording comes from the active format pack (design spec §E.1). */
const P = formatPack.messages.en.leagueAdmin;

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
    namePlaceholder: 'e.g. Spring League 2026',
    description: 'Description (optional)',
    descriptionPlaceholder:
      'e.g. Each participant is locked to 60% of a given type. Describe type assignments, special rules, etc.',
    leagueType: 'League type',
    /**
     * Form-local option labels (the global `enums.formatType` stays as is for the hub and admin
     * pages). The point-buy label is the active format pack's (`leagueAdmin.form.leagueTypeLabel`).
     */
    leagueTypeOption: {
      singles: 'Classic: Singles',
      doubles: 'Classic: Doubles',
      draft: 'Draft',
      evolution_point_buy: P.form.leagueTypeLabel,
    },
    battleFormatFixed: 'Battle format: Singles (fixed)',
    worldTheme: '3D World Theme',
    ruleset: 'Battle ruleset (optional)',
    noRuleset: 'No default ruleset',
    /** `{ruleset}` = the pack's battle ruleset name (`leagueAdmin.form.battleRulesetName`). */
    autoRuleset: 'Battle ruleset: {ruleset} (set automatically)',
    autoRulesetHint:
      'Bans come from the format rules of this league (editable per league after creation). New phases of this league use this ruleset by default.',
    /** The pack's battle ruleset name, for the form and the ruleset row the server creates. */
    autoRulesetName: P.form.battleRulesetName,
    contentLanguage: 'Content language (Discord, reports, overlays)',
    contentLanguageHint:
      'The language of text nobody reads on this site: Discord posts, stored AI reports and stream overlays. Visitors always see their own language.',
    startDate: 'Start Date',
    endDate: 'End Date',
    submit: 'Create League',
    saveFailed: 'Failed to save',
    // The league details form on the Settings tab (LeagueSettingsForm)
    saveChanges: 'Save changes',
    saved: 'League settings saved.',
    datesInvalid: 'The end date must not be before the start date.',
    leagueTypeLockedStarted:
      'The league type can no longer be changed: the league has started (it is active or completed, or a phase has rounds).',
    leagueTypeLockedPointBuy:
      'A point-buy league keeps its league type, and other leagues cannot become one: its setup (format rules, point-buy list, battle ruleset) is created together with the league.',
    rulesetEditHint:
      'The default for new phases and for team validation where a phase has no custom ruleset of its own. Existing phases keep theirs.',
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
    label: 'Test league — listed with a test badge, excluded from ratings and all-time stats',
    hint: "The league stays listed (after the real leagues, badged) so the community can test in it. Its games do not count toward player ratings: changing this setting rebuilds the ratings of the league's players. Games recorded before the flag was set stay in the all-time stats.",
    saving: 'Saving and rebuilding ratings…',
    saveFailed: 'Failed to update the test-league flag',
    // The flag was saved, but the rating rebuild after it reported a problem: it failed, or ran to its pass cap unsettled
    // ({warning}: the catalogued text of data.rebuild_warning, which says which)
    ratingRebuildWarning: 'Rating rebuild: {warning}',
    // The save request got no answer from the route (network error, timeout, a non-JSON 504): the flag may be saved
    saveUnconfirmed:
      'No answer arrived, so the save is unconfirmed. The checkbox now shows the stored setting. If the ratings were not rebuilt, a site admin can repair them with Record Reconciliation in the admin data tools, repeating the repair until its dry run lists no rating mismatch.',
  },
  formatRules: {
    loading: 'Loading format rules...',
    loadFailed: 'Failed to load format rules',
    empty: 'No format rules configured yet. Initialize with default Evolution Point Buy rules?',
    initialize: 'Initialize Default Rules',
    initializing: 'Initializing...',
    initializeFailed: 'Failed to initialize format rules',
    retry: 'Retry',
    /** `{token}` = glossary `token.draftKill`; `{bans}` = number of default banned moves and items. */
    initializeConfirm: {
      title: 'Initialize default rules?',
      message:
        'This creates the default rules for this league: a budget of {budget}, {picks} picks, a {token} ratio of {ratio}:1, a {token} limit of {tokenMax} ({perLine} per line) and {bans} default bans. You can edit them afterwards.',
      confirm: 'Initialize',
    },
    save: 'Save format rules',
    saving: 'Saving...',
    reset: 'Reset',
    unsavedHint: 'You have unsaved changes.',
    saved: 'Format rules saved.',
    saveFailed: 'Failed to save format rules',
    picks: 'Picks',
    /** `{token}` = glossary `token.draftKill`. */
    tokenRatio: '{token} ratio',
    /** `{token}` = glossary `token.draftKill`. */
    tokenMax: '{token} limit',
    /** `{token}` = glossary `token.draftKill`. */
    perLineLimit: '{token} limit per line',
    /** The allowed range of a number field. */
    range: '{min}–{max}',
    ratioValue: '{ratio}:1',
    poolHint: 'Budget and picks apply to draft pools created after saving. Existing draft pools keep theirs.',
    bannedMoves: 'Banned Moves',
    bannedItems: 'Banned Items',
    teraRules: 'Tera Rules',
    /** `{stage}` = glossary roster stage, `{rule}` = enums `teraRule`. */
    teraRule: '{stage}: {rule}',
    teraPinned: 'Tera rules come from the format pack and cannot be edited here.',
    redraftPhase: {
      label: 'Redraft phase',
      open: 'Open',
      closed: 'Closed',
      hint: 'The Redraft phase is opened and closed in the Redraft section of the Draft tab, not here.',
    },
    tiebreakerOrder: 'Tiebreaker Order',
    tiebreakerHint:
      'The standings rank players by this order, first step first, and the league’s rules page shows it. A decision match, if listed, comes last and only flags players who are still tied.',
    /** The three buttons of a tiebreaker step; `{step}` = the step’s name. */
    tiebreakerMoveUp: 'Move {step} up',
    tiebreakerMoveDown: 'Move {step} down',
    tiebreakerRemove: 'Remove {step}',
    addStep: 'Add step',
    addStepNone: 'Every tiebreaker step is already in the list.',
    tiebreaker: {
      match_points: 'Match points',
      evolution_points: 'Evolution points',
      kill_difference: 'KO difference',
      head_to_head: 'Head to head',
      decision_match: 'Decision match',
    },
    /** Asked before saving into a league that has started. */
    confirmStarted: {
      title: 'Change the rules of a started league?',
      message:
        'This league has already started. The new rules apply from now on. Past results are kept and existing draft pools are not recomputed, but the standings are ranked by the new tiebreaker order straight away.',
      confirm: 'Save rules',
    },
    error: {
      required: 'Enter a value.',
      notInteger: 'Enter a whole number.',
      /** `{min}` = the smallest allowed value. */
      tooSmall: 'Must be at least {min}.',
      /** `{max}` = the largest allowed value. */
      tooBig: 'Must be at most {max}.',
      empty: 'This cannot be empty.',
      duplicate: 'Each entry can appear only once.',
      /** `{max}` = the longest allowed name. */
      tooLong: 'Names can have at most {max} characters.',
      decisionLast: 'A decision match can only be the last step.',
    },
  },
  phasePage: {
    /** An admin of another league opened this league's phase page. */
    forbidden: 'Only admins of this league can open its phases.',
    subtitle: '{league} · Phase {order} · {bracket} · {bestOf} · {status}',
    /** Goes to the league admin page's Phases tab (`?tab=phases`). */
    back: '← Back to {name}: Phases',
    newPhaseHint:
      'Step 2: Participants are enrolled from the league table. Adjust seeds if needed, then generate the bracket below.',
    overview: 'Overview',
    description: 'Description',
    participants: 'Participants',
    groups: 'Groups',
    rounds: 'Rounds',
  },
} as const;
