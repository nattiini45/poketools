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
    removeFromSeason: 'Remove from Season',
    removeFromSeasonLabel: 'Remove from Season: {name}',
    removeFromSeasonHint: 'Enter a season UUID below to enable this',
  },

  season: {
    title: 'Season-Level Test Data',
    intro:
      'Enter a season UUID, then use <strong>Remove from Season</strong> on a player row above (drops that player\'s participation + season progression), or delete every match in the season whose <strong>both</strong> participants are test accounts.',
    idLabel: 'Season UUID',
    deleteMatches: 'Delete Test-Only Matches',
  },

  // Confirmation dialogs of the destructive actions (shared ConfirmDialog).
  confirm: {
    reset: {
      title: 'Reset data?',
      message:
        'This deletes the evolution progress, token grants and match evolution snapshots of {name} in every season. The account and its matches stay. This cannot be undone.',
      confirm: 'Reset data',
    },
    replaceLogin: {
      title: 'Reset login?',
      message:
        '{name} already has a login. This replaces its password with a new one, and the old password stops working at once. The new credentials are shown once.',
      confirm: 'Reset login',
    },
    clearLogin: {
      title: 'Clear login?',
      message:
        'This deletes the login of {name}. They cannot sign in again until you mint a new login.',
      confirm: 'Clear login',
    },
    removeFromSeason: {
      title: 'Remove from season?',
      message:
        'This removes {name} from season {season}: their participation, season progression and token grants in that season are deleted. Historical match snapshots stay. This cannot be undone.',
      confirm: 'Remove from season',
    },
    deleteMatches: {
      title: 'Delete test-only matches?',
      message:
        'This deletes every match in season {season} in which both participants are test accounts, including its games, battle stats and analyses. Matches with a real player are not touched. This cannot be undone.',
      confirm: 'Delete matches',
    },
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
