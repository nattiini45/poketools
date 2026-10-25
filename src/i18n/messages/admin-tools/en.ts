/**
 * Namespace `admin-tools` (owner T09, i18n-core §11.3): `/admin/{data,
 * meta-data,audit,achievements,wiki,rulesets,social}/**`. Kale stays English
 * and does not use it (design decision).
 *
 * English values are the pre-i18n literals verbatim, except that the
 * "(s)" / "(es)" pseudo-plurals became plural objects and sentences that
 * used to be concatenated are whole messages here.
 */
export default {
  /** The "back to /admin" button in every page header. */
  backToAdmin: 'Admin',
  networkError: 'Network error',

  data: {
    title: 'Data Tools',
    subtitle: 'Import players and export operational data',
    jobs: {
      title: 'Aggregate Jobs',
      intro:
        'Usage stats trail replay writes until pending jobs finish (cron runs every minute). Drain the queue after bulk imports, or rebuild a scope from battle_stats when drift is suspected. Rebuild clears existing aggregate rows for the scope before recomputing — usage pages may show empty or partial stats until the rebuild finishes (especially for all-time). Do not edit or delete games of the scope while its rebuild runs: a game changed during the rebuild can end up counted wrongly, and only another rebuild of the scope corrects it.',
      loadingStats: 'Loading job stats…',
      loadFailed: 'Failed to load aggregate job stats',
      drainFailed: 'Failed to drain aggregate jobs',
      rebuildFailed: 'Failed to rebuild aggregates',
      status: {
        pending: 'Pending',
        processing: 'Processing',
        failed: 'Failed',
        completed: 'Completed',
        cancelled: 'Cancelled',
      },
      refreshStats: 'Refresh Stats',
      drain: 'Drain Pending Jobs',
      drainResult: {
        one: 'Processed {processed}, failed {failed}, reclaimed {reclaimed} across {count} round. Pending now {pending}.',
        other: 'Processed {processed}, failed {failed}, reclaimed {reclaimed} across {count} rounds. Pending now {pending}.',
      },
      rebuildScope: 'Rebuild scope',
      scopes: {
        all_time: 'All time',
        league: 'League / season',
        tournament: 'Tournament',
      },
      scopeId: 'Scope ID',
      scopeIdNotRequired: 'Not required for all time',
      uuid: 'UUID',
      rebuild: 'Rebuild Scope',
      rebuiltGames: { one: 'Rebuilt {count} game.', other: 'Rebuilt {count} games.' },
      cleared: 'Cleared {aggregateRows} and {playerAggregateRows}.',
      aggregateRows: { one: '{count} aggregate row', other: '{count} aggregate rows' },
      playerAggregateRows: { one: '{count} player aggregate row', other: '{count} player aggregate rows' },
    },
    reconcile: {
      title: 'Record Reconciliation',
      intro:
        'Verify player, Pokémon, and Evolution-League records against values rebuilt from the remaining matches. Dry-run (Verify) reports mismatches only; Repair rewrites derived data (EPB progression, ratings, league aggregates, streaks) from the authoritative sources. Note: “all seasons” repair is heavy and runs serialized to avoid cross-season rating-history races — expect it to take a while.',
      scope: 'Scope',
      scopes: { season: 'Season', all: 'All seasons' },
      seasonId: 'Season ID',
      seasonIdNotRequired: 'Not required for all seasons',
      mode: 'Mode',
      modes: { verify: 'Verify (dry-run)', repair: 'Repair' },
      repairButton: 'Repair Records',
      verifyButton: 'Verify Records',
      confirmRepair:
        'Repair will rewrite derived records (EPB progression, ratings, league aggregates, streaks) for this scope. Continue?',
      failed: 'Failed to run record reconciliation',
      allConsistent: 'All records consistent — 0 mismatches found.',
      allConsistentSeasons: {
        one: 'All records consistent — 0 mismatches found across {count} season.',
        other: 'All records consistent — 0 mismatches found across {count} seasons.',
      },
      seasonsSummary: '{seasons} — {mismatches}',
      seasonCount: { one: '{count} season', other: '{count} seasons' },
      totalMismatchCount: { one: '{count} total mismatch', other: '{count} total mismatches' },
      mismatchCount: { one: '{count} mismatch', other: '{count} mismatches' },
      repaired: 'repaired',
      // Rating-history integrity of the report (ratings.integrity; src/lib/reconcile/reconcile-season.ts)
      gapCount: { one: '{count} rating-history gap', other: '{count} rating-history gaps' },
      repairWouldRefuse: 'repair would refuse the ratings',
      integrity: {
        repairHeals:
          'Rating history is incomplete. The repair rebuilds the player whose row is missing first and rates the never-rated matches.',
        repairRefuses: 'The repair would refuse the ratings step: {reason}',
      },
      stats: {
        totalMismatches: 'Total mismatches',
        repaired: 'Repaired',
        evolutionMismatches: 'Evolution mismatches',
        evolutionValue: '{mismatches} (+{impossible} impossible)',
        notEpb: 'n/a (not EPB)',
        ratingMismatches: 'Rating mismatches',
        notAvailable: 'n/a',
        playersAffected: 'Players affected',
        evolutionRepaired: 'Evolution repaired (trackers / events / points)',
        ratingsRewritten: 'Ratings players rewritten',
        aggregatesProcessed: 'Aggregates games processed (rows deleted)',
        aggregatesValue: '{games} ({rows})',
        streaksRecomputed: 'Streaks players recomputed',
        historyGaps: 'Rating-history gaps',
        unratedMatches: 'Never-rated matches',
      },
    },
    import: {
      title: 'Player Import',
      csv: 'CSV',
      mode: 'Mode',
      modes: { insert: 'Insert', upsert: 'Upsert' },
      button: 'Import',
      failed: 'Import failed',
      result: '{imported} imported, {updated} updated, {skipped} skipped',
    },
    export: {
      title: 'Data Export',
      resource: 'Resource',
      resources: {
        players: 'Players',
        tournaments: 'Tournaments',
        matches: 'Matches',
        seasons: 'Seasons',
        games: 'Games',
        battle_stats: 'Battle Stats',
      },
      format: 'Format',
      limit: 'Limit',
      button: 'Export',
      failed: 'Export failed',
      remaining: { one: '{count} export remaining today', other: '{count} exports remaining today' },
      ready: 'Export ready',
      summary: 'Exported {count} of {total} rows',
      summaryLimited:
        'Exported {count} of {total} rows. The limit was reached; raise it (up to 10,000) to export more.',
      summaryMaxed: 'Exported {count} of {total} rows. One export holds at most 10,000 rows.',
    },
    /** Read-only report on `/admin/data`: stored league settings vs what the engine uses. */
    formatDrift: {
      title: 'Format drift report',
      subtitle: 'Compare what leagues have stored with what the engine actually uses.',
      run: 'Run report',
      running: 'Running…',
      retry: 'Retry',
      failed: 'Failed to build the format drift report',
      readOnlyNote:
        'This report only reads and changes nothing. Standings use the tiebreaker order stored with each league, and enrolling a phase reads the advancement rule from the phase being enrolled (the target phase).',
      /** `{max}` = the row cap of one read. */
      truncated: 'The report is partial: a read stopped at {max} rows, so some leagues or phases are missing.',
      generatedAt: 'Generated {time}',
      archivedBadge: 'Archived',
      testBadge: 'Test',
      summary: {
        leaguesChecked: { one: '{count} league with format rules checked', other: '{count} leagues with format rules checked' },
        tiebreakerMismatches: { one: '{count} differs from the format pack default', other: '{count} differ from the format pack default' },
        pairsChecked: { one: '{count} phase pair with a rule checked', other: '{count} phase pairs with a rule checked' },
        pairsConsistent: { one: '{count} consistent', other: '{count} consistent' },
        pairsMismatching: { one: '{count} mismatching', other: '{count} mismatching' },
      },
      tiebreaker: {
        title: 'Tiebreaker order',
        intro:
          'A league’s standings use the tiebreaker order stored with it. These leagues store an order that differs from the format pack default.',
        stored: 'Stored (used by the standings)',
        pack: 'Format pack default',
        /** Shown when the stored order cannot rank a table, so the standings fall back to the format pack default. */
        unusable:
          'The stored order cannot rank a table (it is empty, has an unknown or repeated step, has a decision match that is not last, or has nothing to rank by), so this league’s standings use the format pack default.',
        empty: 'No differences found: every stored order matches the format pack default.',
      },
      advancement: {
        title: 'Advancement rules',
        intro:
          'A rule stored on one phase of a consecutive pair is applied or shown on the other. These pairs disagree.',
        empty: 'No differences found: no advancement rule sits on the wrong side of a phase pair.',
        source: 'Source phase',
        target: 'Target phase',
        ruleNone: 'none',
        /** `{count}` = players that advance. */
        ruleTop: 'top {count}',
        ruleTopPerGroup: 'top {count} per group',
        kindLabel: {
          source_only: 'Rule on the source phase only',
          target_only: 'Rule on the target phase only',
          both_differ: 'Rules differ',
          orphan: 'Unused rule',
        },
        kind: {
          source_only:
            'The timeline shows this rule between the two phases, but enrolling the target phase reads the target’s own rule, so no cut is applied.',
          target_only:
            'Enrolling the target phase applies this rule, but the timeline shows no label for it between the two phases.',
          both_differ:
            'Enrolling the target phase uses the target’s rule, while the timeline shows the source phase’s rule.',
          orphan: 'This is the league’s only phase and nothing reads its rule.',
        },
      },
    },
  },

  metaData: {
    title: 'Meta Data',
    subtitle: 'Smogon usage stats & sample sets — coverage and manual imports',
    loadFailed: 'Failed to load coverage',
    importFailed: 'Import failed',
    setsFailed: 'Sample set import failed',
    setsRefreshed: 'Sample sets refreshed for all generations.',
    importResult: 'Imported {success}/{total} formats ({pokemon} Pokémon, {errors} errors) in {seconds}s',
    usageTitle: 'Usage Statistics',
    usageSubtitle:
      '{imported}/{available} available formats imported from data.pkmn.cc. New metas (e.g. a fresh VGC season) appear here automatically once Smogon publishes them.',
    loadingCoverage: 'Loading coverage…',
    importing: 'Importing…',
    importAll: 'Import all available',
    refreshSets: 'Refresh sample sets',
    noFormats: 'No formats available',
    columns: {
      format: 'Format',
      pokemon: 'Pokémon',
      lastImported: 'Last imported',
    },
    never: 'never',
    refresh: 'Refresh',
    import: 'Import',
    cronNote:
      'A Vercel cron refreshes all usage stats and gen 8–9 sample sets on the 3rd of every month (<code>{path}</code>). Use the buttons above when a meta updates mid-month.',
  },

  audit: {
    title: 'Audit Log',
    subtitle: 'Review administrative and system activity',
    filters: {
      title: 'Filters',
      action: 'Action',
      actor: 'Actor',
      actorPlaceholder: 'Admin name',
      resourceType: 'Resource Type',
      resourceId: 'Resource ID',
      resourceIdPlaceholder: 'UUID',
      resourceIdInvalid: 'Enter a valid UUID, for example 123e4567-e89b-12d3-a456-426614174000.',
      from: 'From',
      to: 'To',
      apply: 'Apply',
      clear: 'Clear',
    },
    events: {
      title: 'Audit Events',
      loading: 'Loading...',
      range: '{start}-{end} of {total}',
      empty: 'No audit events found.',
      loadFailed: 'Failed to load audit log',
      actorOn: '{actor} on {resourceType}',
      actorOnNamed: '{actor} on {resourceType}: {resourceName}',
      noResourceId: 'no resource id',
    },
  },

  achievements: {
    title: 'Achievement Definitions',
    intro: 'Manage the achievement catalog, including hidden and repeatable definitions.',
    catalogNote:
      'Name and description are stored exactly as entered. Achievements that have an entry in the translation catalog show the catalog text to players instead.',
    catalogHint: 'Catalog text: {name}',
    form: {
      key: 'Key',
      name: 'Name',
      description: 'Description',
      icon: 'Icon (emoji or text)',
      category: 'Category',
      tier: 'Tier',
      repeatable: 'Repeatable',
      hidden: 'Hidden',
      criteria: 'Criteria (JSON)',
      saving: 'Saving...',
      createTitle: 'Create Definition',
      create: 'Create',
      editTitle: 'Edit Definition',
      saveChanges: 'Save Changes',
    },
    categories: {
      combat: 'Combat',
      milestone: 'Milestone',
      social: 'Social',
      rare: 'Rare',
      meta: 'Meta',
    },
    tiers: {
      bronze: 'Bronze',
      silver: 'Silver',
      gold: 'Gold',
      platinum: 'Platinum',
    },
    list: {
      title: 'Existing Definitions',
      loading: 'Loading definitions...',
      empty: 'No achievement definitions found.',
      emptyTable: 'No achievement definitions found',
      columns: {
        key: 'Key',
        name: 'Name',
        tier: 'Tier',
        category: 'Category',
        criteria: 'Criteria',
        actions: 'Actions',
      },
    },
    confirmDelete: 'Delete achievement "{key}"?',
    errors: {
      invalidCreate: 'Create payload is invalid. Check required fields and criteria JSON.',
      invalidEdit: 'Edit payload is invalid. Check required fields and criteria JSON.',
      requestFailed: 'Request failed ({status})',
      loadFailed: 'Failed to load achievement definitions',
      createFailed: 'Failed to create achievement definition',
      updateFailed: 'Failed to update achievement definition',
      deleteFailed: 'Failed to delete achievement definition',
    },
  },

  wiki: {
    title: 'Wiki Moderation',
    subtitle: 'Review community notes and reports',
    pendingNotes: 'Pending Notes',
    loading: 'Loading...',
    noPending: 'No pending notes.',
    by: 'By {name}',
    flags: 'Flags: {flags}',
    rejectionReason: 'Rejection reason',
    approve: 'Approve',
    reject: 'Reject',
    openReports: 'Open Reports',
    noReports: 'No open reports.',
    reviewed: 'Reviewed',
    dismiss: 'Dismiss',
    unpublish: 'Unpublish note',
    noteLive: 'This note is public',
    noteHidden: 'This note is not public',
    loadFailed: 'Failed to load moderation queue',
    actionFailed: 'The moderation action failed',
    rejectedNotes: 'Rejected Notes',
    viewPending: 'Pending',
    viewRejected: 'Rejected',
    noRejected: 'No rejected notes.',
    blocked: 'Blocked',
    blockedHint: 'The author can no longer edit this note back into the queue.',
    blockResubmission: 'Block from resubmitting',
    allowResubmission: 'Allow resubmitting',
    blockDialog: {
      title: 'Block this note from resubmitting?',
      message:
        'This is final for the author: they can no longer edit this note to send it back for review. Only you can undo it.',
      confirm: 'Block from resubmitting',
    },
    /**
     * Keys = the report `reason` enum of `wikiNoteReportSchema` (src/lib/validation/schemas.ts),
     * except `other` -> `otherReason`: `other` is reserved for plural forms (i18n-core §1.3).
     */
    reportReasons: {
      inaccurate: 'Inaccurate',
      spam: 'Spam',
      abusive: 'Abusive',
      off_topic: 'Off topic',
      otherReason: 'Other',
    },
  },

  rulesets: {
    title: 'Manage Rulesets',
    newRuleset: '+ New Ruleset',
    empty: 'No rulesets yet.',
    doubles: 'Doubles',
    clauses: { one: '{count} clause', other: '{count} clauses' },
    bans: { one: '{count} ban', other: '{count} bans' },
    createTitle: 'Create Ruleset',
    editTitle: 'Edit Ruleset: {name}',
  },

  social: {
    title: 'Social Integration',
    intro:
      'Configure outbound notifications for Discord, X, Threads, and Bluesky. Discord uses channel webhooks. X, Threads, and Bluesky use provider credentials.',
    discordTitle: 'Discord',
    discordIntro: 'Configure Discord webhook URLs per scope and event type.',
    othersTitle: 'X, Threads, and Bluesky',
    othersIntro: 'Configure provider credentials, event filters, and scope for outbound posts.',
  },
} as const;
