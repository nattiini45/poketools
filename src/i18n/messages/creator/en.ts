/**
 * Namespace `creator` (owner T16, i18n-core §11.3): the Creator Hub pages
 * (`src/app/creator/**`), the creator nav and hub cards
 * (`src/components/creator/*.tsx`) and the player broadcast pages
 * (`src/app/(player)/dashboard/broadcast/**`).
 *
 * The Cast Studio components use the sub-namespace `creator/studio`, the
 * content dashboard components `creator/content`. English values are the
 * pre-i18n literals verbatim. Pokémon data names are never stored here.
 */
export default {
  meta: {
    hubTitle: 'Creator Hub | PokeTools',
    studioTitle: 'Cast Studio | PokéTools',
    studioDescription: 'Create and manage broadcast sessions for livecasts, replaycasts, and solo streams',
    overlaysTitle: 'Overlay Manager | PokeTools',
  },
  nav: {
    studio: 'Studio',
    wiki: 'Wiki',
    overlays: 'Overlays',
  },
  hub: {
    title: 'Creator Hub',
    signInPrompt: 'Sign in to access Creator tools — manage overlays, run cast sessions, and build broadcast content.',
    signIn: 'Sign In',
    browseWiki: 'Browse Wiki',
    welcome: 'Welcome back, {name}. What are you working on?',
  },
  quickActions: {
    newSession: {
      title: 'New Cast Session',
      description: 'Start a live broadcast session with overlays and controls.',
    },
    wiki: {
      title: 'Browse Wiki',
      description: 'View and edit broadcast guides, tips, and documentation.',
    },
    overlays: {
      title: 'Manage Overlays',
      description: 'Create, edit, and organize your overlay presets.',
    },
  },
  recentSessions: {
    title: 'Recent Sessions',
    empty: 'Recent sessions will appear here.',
  },
  overlayGallery: {
    title: 'Your Overlay Presets',
    empty: 'Your overlay presets will appear here.',
  },
  overlaysPage: {
    title: 'Overlay Manager',
    comingSoon: 'Overlay manager — coming soon. Your saved presets will appear here.',
    empty: 'No overlay presets yet. Create your first preset from the Studio.',
  },
  studioPage: {
    title: 'Cast Studio',
  },
  toolsPage: {
    title: 'Cast Tools',
    intro: 'Second-screen tools for “{name}”. Keep this tab open alongside the main Cast Studio.',
  },
  broadcastHub: {
    title: 'Broadcast Hub',
    notRegistered: 'Not registered as a player.',
    intro: 'Select a match to open the Live Battle Tracker. Active matches appear first.',
    activeMatches: 'Active Matches',
    track: 'Track →',
    noActive: 'No active matches to track.',
    recentlyCompleted: 'Recently Completed',
    versus: 'vs',
    winnerWon: '{name} won',
  },
  tracker: {
    title: 'Battle Tracker',
    notRegistered: 'Not registered as a player.',
    matchNotFound: 'Match not found.',
    notAuthorized: 'You are not authorized to view this tracker.',
    backToHub: '← Back to Broadcast Hub',
    matchTitle: '{player1} vs {player2}',
    subtitle: 'Live Battle Tracker',
  },
  cheatSheet: {
    title: 'Caster Cheat Sheet',
    creatorRequired: 'Creator access required.',
    matchNotFound: 'Match not found.',
    back: '← Back',
  },
  broadcastError: {
    title: 'Broadcast tracker error',
    fallback: 'An unexpected error occurred in the broadcast tracker.',
    tryAgain: 'Try again',
    goBack: 'Go back',
  },
} as const;
