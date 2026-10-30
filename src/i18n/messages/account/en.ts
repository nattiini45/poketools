/**
 * Namespace `account` (owner T01, i18n-core §11.3): the player settings
 * sections in `src/components/player` (login methods, AI assistant,
 * gaming usernames, 3D world experience). English values are the literals
 * these files have always shown.
 */
export default {
  security: {
    title: 'Login methods',
    intro: 'Link both so you can sign in either way — same player, same teams and stats.',
    discord: 'Discord',
    linked: 'Linked',
    notLinked: 'Not linked',
    linkDiscord: 'Link Discord',
    emailPassword: 'Email & password',
    unconfirmed: '{email} (unconfirmed — check your inbox)',
    addEmail: 'Add email login',
    email: 'Email',
    password: 'Password',
    passwordHint: 'At least 8 characters.',
    confirmPassword: 'Confirm password',
    passwordsMismatch: 'Passwords do not match.',
    linkEmail: 'Link email login',
    cancel: 'Cancel',
    emailLinked: 'Email login added. Check your inbox to confirm the address before using it to sign in.',
    loadFailed: 'Failed to load linked accounts.',
    linkEmailFailed: 'Failed to link email login. Please try again.',
    resendVerification: 'Is it your address and still unconfirmed? Send the confirmation email again',
    linkDiscordFailed: 'Failed to start Discord linking. Please try again.',
  },
  agentSettings: {
    title: 'AI Assistant',
    badge: 'AI',
    intro:
      'Choose your default assistant and the order models are tried. Higher models run first; the assistant falls back down the list when one is unavailable.',
    loading: 'Loading your settings…',
    defaultAssistant: 'Default Assistant',
    modelPriority: 'Model Priority',
    moveUp: 'Move {model} up',
    moveDown: 'Move {model} down',
    save: 'Save AI Settings',
    saved: 'AI settings saved.',
    loadFailed: 'Could not load your AI settings.',
    saveFailed: 'Failed to save settings',
    /** Keyed by `agentPersonaSchema` value. */
    personas: {
      linden_teambuilding: 'Professor Linden — Teambuilding',
      linden_match_prep: 'Professor Linden — Match Prep',
      kale: 'Kale — Tournament Reports (admin)',
    },
  },
  usernames: {
    title: 'Gaming Usernames',
    edit: 'Edit',
    intro: 'Set your usernames for Pokémon Showdown and Pokémon Champions to display on your profile.',
    showdown: 'Pokémon Showdown Username',
    showdownPlaceholder: 'Enter your PS username',
    champions: 'Pokémon Champions Username',
    championsPlaceholder: 'Enter your Champions username',
    save: 'Save Usernames',
    saved: 'Usernames updated successfully!',
    failed: 'Failed to update usernames',
  },
  worldExperience: {
    title: '3D world experience',
    intro: 'Choose whether league pages render their 3D route worlds for you.',
    staleRead:
      'Your saved preference could not be loaded, so “{option}” is preselected as a fallback — it may not be the value currently stored. Saving will overwrite the stored preference with your selection.',
    legend: 'Route worlds',
    save: 'Save preference',
    saved: '3D world setting saved.',
    saveFailed: 'Failed to save your 3D world setting.',
    saveFailedRetry: 'Failed to save your 3D world setting. Please try again.',
    /** Keyed by `WorldExperience`. */
    options: {
      auto: {
        label: 'Auto',
        help: 'PokéTools decides from your device, connection and motion preferences.',
      },
      on: {
        label: 'Always on',
        help: 'Skip the data-saver and low-power heuristics. Reduced-motion and devices without WebGL still stay on the simple version.',
      },
      off: {
        label: 'Always off (default)',
        help: 'Never load the 3D worlds; always show the simple version.',
      },
    },
  },
} as const;
