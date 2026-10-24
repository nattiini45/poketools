/**
 * Namespace `shell` (owner T01, i18n-core §11.3): the root error and 404
 * pages, the live view guards, the session button, the theme toggle, the PWA
 * prompt, the guest badge and the admin shell (sidebar and match list).
 * English values are the literals these files have always shown.
 */
export default {
  errorPage: {
    title: 'Something went wrong',
    fallback: 'An unexpected error occurred.',
    retry: 'Try again',
    back: 'Go back',
  },
  notFound: {
    title: 'Page not found',
    body: "The page you're looking for doesn't exist or has been moved.",
    home: 'Back to home',
  },
  guards: {
    accessDenied: 'Access Denied',
    adminOnly: 'You need admin privileges to view this page.',
    creatorOnly: 'You need content creator privileges to view this page.',
    siteAdminOnly: 'Only site admins can view this page.',
    resourceForbidden: 'You are not an admin of this league or tournament.',
  },
  session: {
    signIn: 'Sign In',
    signOut: 'Sign Out',
  },
  theme: {
    toLight: 'Switch to light mode',
    toDark: 'Switch to dark mode',
  },
  pwa: {
    install: 'Install PokéTools App',
    iosHint: "Add to Home Screen from Safari's Share menu for the app experience.",
  },
  guest: 'Guest',
  admin: {
    navLabel: 'Admin',
    legacy: 'legacy',
    groups: {
      competitions: 'Competitions',
      community: 'Community',
      system: 'System',
    },
    items: {
      overview: 'Overview',
      leagues: 'Leagues',
      archivedLeagues: 'Archived leagues',
      tournaments: 'Tournaments',
      archivedTournaments: 'Archived tournaments',
      matches: 'Matches',
      rulesets: 'Rulesets',
      players: 'Player roster',
      achievements: 'Achievements',
      wiki: 'Wiki moderation',
      social: 'Social integration',
      data: 'Data tools',
      metaData: 'Meta data',
      audit: 'Audit log',
      testPlayers: 'Test players',
      kale: 'Kale console',
    },
    matches: {
      /** Status filter tabs, keyed by `match_status` (`all` = no filter). */
      status: {
        all: 'All',
        scheduled: 'Scheduled',
        in_progress: 'In Progress',
        pending_confirmation: 'Pending',
        completed: 'Completed',
        disputed: 'Disputed',
      },
      searchPlaceholder: 'Search players or match ID...',
      searchLabel: 'Search matches',
      league: 'League',
      allLeagues: 'All leagues',
      noLeague: 'No league (standalone)',
      phase: 'Phase',
      allPhases: 'All phases',
      tournament: 'Tournament',
      allTournaments: 'All Tournaments',
      archivedOption: '{name} (archived)',
      testOption: '{name} (test)',
      /** The select label of a deep-linked league or phase while the filter choices load. */
      loadingOption: 'Loading...',
      leaguePhase: '{league} / {phase}',
      searchTruncated: 'Your search matches many players. Only the first {count} are included; type more of the name to narrow it down.',
      filtersFailed: 'Failed to load the league and phase filters',
      retry: 'Retry',
      noSearchResults: 'No matches match your search.',
      none: 'No matches found.',
      versus: '{player1} vs {player2}',
      winner: 'W: {name}',
      override: 'Override',
      submitResult: 'Submit Result',
      viewPrep: 'View Prep',
      range: 'Showing {from}–{to} of {total}',
      pageOf: 'Page {page} of {pages}',
      previous: 'Previous',
      next: 'Next',
      loadFailed: 'Failed to load matches',
    },
  },
} as const;
