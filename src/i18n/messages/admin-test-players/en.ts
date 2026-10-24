/**
 * Namespace `admin-test-players`: `/admin/test-players` (the page header and
 * `TestPlayersConsole`).
 *
 * English values are the pre-i18n literals verbatim, except that the "(s)"
 * pseudo-plurals became plural objects and the sentences that used to be
 * concatenated are whole messages here.
 */
export default {
  page: {
    title: 'Test Players',
    subtitle: '14 isolated dummy accounts for development & admin testing (excluded from all public/global data)',
    back: 'Admin',
  },

  standard: {
    title: 'Standard Test Players',
    intro:
      'Creating ensures exactly 14 dummy accounts (EvoTest01–EvoTest14) exist, marked <code>is_test_account</code> and excluded from every public/global surface. Idempotent — safe to run repeatedly.',
    ensure: 'Create / Repair 14 Test Players',
    refresh: 'Refresh',
    loading: 'Loading test accounts…',
    empty: 'No test accounts yet. Click <strong>Create / Repair</strong> to create the 14 standard accounts.',
    tableEmpty: 'No test accounts',
    mintedNote: 'Shown once — store it before navigating away. Reset anytime with "Reset Login".',
  },

  table: {
    name: 'Name',
    psUsername: 'PS Username',
    login: 'Login',
    actions: 'Actions',
    testBadge: 'Test',
    loginEnabled: 'enabled',
    loginDisabled: 'disabled',
  },

  actions: {
    reset: 'Reset Data',
    mintLogin: 'Mint Login',
    resetLogin: 'Reset Login',
    clearLogin: 'Clear Login',
  },

  season: {
    title: 'Season-Level Test Data',
    intro:
      'Remove a test player from a season (drops their participation + season progression), or delete every match in a season whose <strong>both</strong> participants are test accounts.',
    idLabel: 'Season UUID',
    remove: 'Remove {name} From Season',
    fallbackPlayer: 'Player',
    deleteMatches: 'Delete Test-Only Matches',
  },

  notice: {
    ensured: {
      one: 'Ensured {count} standard test player.',
      other: 'Ensured {count} standard test players.',
    },
    minted: 'Login credentials minted for {name}.',
    done: {
      reset: 'Reset data — done for {name}.',
      mint_login: 'Mint login — done for {name}.',
      clear_login: 'Clear login — done for {name}.',
    },
    removed: 'Removed {name} from season {season}.',
    deleted: {
      one: 'Deleted {count} test-only match in season {season}.',
      other: 'Deleted {count} test-only matches in season {season}.',
    },
  },

  error: {
    network: 'Network error',
    loadFailed: 'Failed to load test accounts',
    ensureFailed: 'Failed to ensure test players',
    failed: {
      reset: 'Reset data failed',
      mint_login: 'Mint login failed',
      clear_login: 'Clear login failed',
    },
    removeFailed: 'Remove from league failed',
    deleteMatchesFailed: 'Delete test matches failed',
    seasonRequiredRemove: 'Enter a season UUID to remove the selected player from',
    seasonRequiredDelete: 'Enter a season UUID to delete its test-only matches',
    noPlayers: 'No test players available',
  },
} as const;
