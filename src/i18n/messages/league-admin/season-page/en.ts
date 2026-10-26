/**
 * Namespace `league-admin/season-page` (owner DF7b, i18n-core §1.4 / draft-frontend §7.4):
 * the admin league page `src/app/admin/leagues/[id]/page.tsx` and its content-language control.
 *
 * Token names come from `glossary.token.*`, format and status labels from `enums`.
 * The league's own copy (`typeCores.subtitle`) comes from the active format pack (design spec §E.1).
 */
import { formatPack } from '@/lib/format-pack';

const P = formatPack.messages.en.leagueAdminSeasonPage;

export default {
  /** An admin of another league opened this one's admin page. */
  forbidden: 'Only admins of this league can open its admin page.',
  header: {
    /** `{format}` = enums `formatType`. */
    subtitle: '{format}',
    /** `{ruleset}` = the ruleset's own name. */
    subtitleWithRuleset: '{format} · {ruleset}',
    archived: '{subtitle} · Archived',
    testBadge: 'Test',
  },
  /** The tab strip (`src/lib/league-admin/tabs.ts`); each tab is a link (`?tab=`). */
  tabs: {
    /** The tab strip's `<nav>` landmark name. */
    label: 'League admin sections',
    overview: 'Overview',
    participants: 'Participants',
    draft: 'Draft',
    /** The league's phases (there is no league-scoped match list). Old `?tab=schedule` links still open it. */
    phases: 'Phases',
    rules: 'Rules',
    /** The read-only Format Studio view of the league (generated outline, rules text, diagnostics). */
    format: 'Format',
    settings: 'Settings',
    danger: 'Danger zone',
    /** Native confirm before a tab switch while the open tab holds unsaved input (forms marked `data-unsaved`). */
    unsavedConfirm: 'This tab has unsaved changes. Switch tabs and lose them?',
  },
  overview: {
    title: 'At a glance',
    /** The league type (classic singles, doubles, draft, point buy); the battle format is its own fact. */
    format: 'League type',
    battleFormat: 'Battle format',
    battleFormatSingles: 'Singles',
    battleFormatDoubles: 'Doubles',
    ruleset: 'Ruleset',
    noRuleset: 'None',
    participants: 'Participants',
    phases: 'Phases',
    status: 'Status',
    dates: 'Dates',
    noDates: 'Not set',
    /** `{start}` / `{end}` = calendar dates. */
    dateRange: '{start} – {end}',
    startOnly: 'From {start}',
    endOnly: 'Until {end}',
    publicPage: 'Open the public league page',
  },
  danger: {
    title: 'Danger zone',
    archiveTitle: 'Archive',
    archiveHint:
      'An archived league leaves the active lists and moves to the archive. Its matches, standings and history stay; you can unarchive it at any time.',
    deleteTitle: 'Delete league',
    /** The delete hint follows the schema's foreign keys (`src/lib/league-admin/season-delete.ts`). */
    deleteIntro: 'Deletes the league permanently, together with:',
    deletes: {
      participants: 'its participants',
      groups: 'its league groups and their members',
      rules: 'its format rules, evolution tiers, tier limits and draft pool list',
      evolution: 'every evolution record: the drafted lines, their progress and evolution events',
      tokens: 'every token grant, Draft Kill Token purchase and Comeback Token spend',
      redraft: 'every Redraft slot, submission, history entry and trade request',
    },
    /** `{list}` = the blocker labels as a list ("phases, draft pools and teams"). */
    deleteBlocked: 'The delete is refused while the league still has {list}. Delete those first.',
    blockers: {
      phases: 'phases',
      draftPools: 'draft pools',
      teams: 'teams',
      storylines: 'storylines',
    },
    deleteUnlinked: 'Cast sessions of the league are kept, no longer linked to it.',
    deleteFinal: 'This cannot be undone.',
    deleteSiteAdminOnly: 'Only site admins can delete a league.',
  },
  description: {
    title: 'Description',
    subtitle: 'Visible to Professor Linden for match analysis context.',
  },
  settings: {
    details: {
      title: 'League details',
      subtitle:
        'Name, league type, battle ruleset and season dates. The description is on the Overview tab; theme and language are below.',
    },
  },
  theme: {
    title: '3D World Theme',
    subtitle: 'Pin the league’s 3D world theme, or leave it on Auto to follow the format default.',
  },
  language: {
    title: 'Content Language',
    subtitle:
      'The language of Discord posts, stored AI reports and stream overlays for this league. Visitors always see the site in their own language.',
    saving: 'Saving…',
    saved: 'Content language saved.',
    saveFailed: 'Failed to update the content language',
  },
  testLeague: {
    title: 'Test League',
    subtitle: 'Site admins only. Marks a league for testing: listed with a test badge, kept out of ratings and all-time stats.',
  },
  participants: {
    title: 'Participants',
  },
  typeCores: {
    title: 'Type Cores (Core Liga)',
    ...P.typeCores,
  },
  evolutionTiers: {
    title: 'Evolution Tiers',
    subtitle: 'Define which Pokémon are available for drafting and how much evolution progress each stage needs.',
  },
  draftPool: {
    title: 'Draft Pool Pokémon',
    subtitle: 'Add Pokémon to the draft pool. These are the Pokémon players can pick during the draft.',
  },
  draftSettings: {
    title: 'Draft Settings',
    subtitle: 'Configure draft slot limits per tier. The draft itself is created on the Draft tab.',
  },
  pointBuyList: {
    title: 'Point-Buy List',
    subtitle:
      'Bind a versioned point-buy list to this season. The list defines all available evolution lines and their prices.',
  },
  formatRules: {
    title: 'Format Rules',
    /** `{token}` = glossary `token.draftKill`. */
    subtitle:
      'Edit the draft budget, picks, {token} limits, bans and the stored tiebreaker order. Tera rules come from the format pack and cannot be edited here.',
  },
  draftRoom: {
    title: 'Draft Room',
    subtitle: 'Manage the live draft session.',
    /** `{type}` = the pool's order and pricing (`draft/legacy/board` `poolFormat.label`), `{status}` = enums `draftPoolStatus`. */
    poolActive: 'Draft pool active: {type} ({status}). Open the <link>Draft Room</link> to manage picks.',
    /** EPB: the draft control panel (`/admin/leagues/[id]/draft`). */
    openPanel: 'Open the draft control panel',
    openPanelHint: 'Start, pause and correct the draft, run the Redraft and read the audit trail.',
    /** EPB: what `draft_create_pool` sets up when the admin creates the Initial draft without a config. */
    epbCreate: {
      intro: 'Creating the Draft Room sets up this draft:',
      /** Same term as the draft control panel's `config.order` (draft/admin), where it is edited. */
      orderLabel: 'Draft order',
      order: 'Snake. The order reverses every round.',
      seatsLabel: 'Seats',
      seats: 'One per participant.',
      pricesLabel: 'Prices',
      prices: 'From the bound point-buy list.',
      budgetLabel: 'Budget',
      /** `{budget}` = format rules `draft_budget`. */
      budget: '{budget} points per player (format rules).',
      /** The season has no format rules row: `draft_create_pool` uses its fallback. */
      budgetDefault: '{budget} points per player (default).',
      rosterLabel: 'Roster size',
      /** `{count}` = format rules `draft_picks`. */
      roster: { one: '{count} pick per player (format rules).', other: '{count} picks per player (format rules).' },
      rosterDefault: { one: '{count} pick per player (default).', other: '{count} picks per player (default).' },
      modeLabel: 'Mode',
      /** `{count}` = the default pick time in minutes. */
      mode: { one: 'Live draft, {count} minute per pick.', other: 'Live draft, {count} minutes per pick.' },
      editHint:
        'Until the draft starts, you can change the draft order, budget, roster size, mode and timers in the draft control panel.',
      create: 'Create Draft Room',
      createFailed: 'Failed to create the Draft Room',
    },
    /** `<link>` = the Rules tab, where the point-buy list is bound. */
    bindListFirst:
      'Bind a point-buy list on the <link>Rules</link> tab first. It defines the evolution lines available in the draft.',
    /** EPB: the season has no participants, so the draft would have no seats. `<link>` = the Participants tab. */
    addParticipantsFirst: 'Add participants on the <link>Participants</link> tab first. Each one gets a seat in the draft.',
    /**
     * EPB: fewer participants than a draft needs to start, or more than it seats
     * (`DRAFT_CONFIG_LIMITS.participant_order`, kept equal to the SQL limits by `seat-limits-sql.test.ts`).
     */
    tooFewParticipants: 'A draft needs at least {min} participants, and this league has {count}. Add more on the <link>Participants</link> tab first.',
    tooManyParticipants: 'A draft has room for at most {max} participants, and this league has {count}. Remove some on the <link>Participants</link> tab first.',
  },
  dataImport: {
    title: 'Data Import',
    subtitle:
      'Import the point-buy list and team roles from the authoritative xlsx workbooks (dry-run preview supported).',
  },
  tokens: {
    title: 'Tokens',
    /** `{draftKill}`, `{comeback}`, `{cosmo}` = glossary `token.*`. */
    subtitle: 'Balances per player: {draftKill}, {comeback} and {cosmo}. Players buy and spend tokens themselves.',
  },
  evolutionPoints: {
    title: 'Evolution Points',
    subtitle: 'Table tiebreaker: at most 1 per trainer per matchday when any of their lines evolves.',
  },
  redraft: {
    title: 'Redraft',
    subtitle: 'The between-legs Redraft (secret drop) runs in the draft control panel.',
    openPanel: 'Open the Redraft in the draft control panel',
  },
  phases: {
    title: 'Phases',
  },
  leagueAdmins: {
    title: 'League Admins',
    subtitle: 'League admins can manage all stages within this league.',
  },
} as const;
