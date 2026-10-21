/** Sprite style setting (docs/pkmn.md, "Sprite styles"): settings card and the language/display menu. */
export default {
  legend: 'Sprite style',
  /** Short legend in the NavBar menu and the mobile drawer. */
  menuLegend: 'Pokémon sprites',
  options: {
    site: {
      label: 'Site default',
      help: 'Follows this site’s default: {style}.',
    },
    broadcast: {
      label: 'Broadcast renders',
      help: 'High-resolution renders. Pokémon without one show the HOME render.',
    },
    home: {
      label: 'HOME renders',
      help: '3D renders as in Pokémon HOME.',
    },
    animated: {
      label: 'Animated',
      help: 'Animated battle sprites.',
    },
    pixel: {
      label: 'Pixel',
      help: 'Classic pixel sprites.',
    },
  },
  /** aria-label of a preview image: the option label and the species shown. */
  previewAlt: '{style} preview: {species}',
  broadcastUnavailable: 'This site has no broadcast renders set up, so HOME renders are shown instead.',
  saving: 'Saving…',
  saved: 'Sprite style saved.',
  saveFailed: 'Your sprite style could not be saved. Please try again.',
  staleRead: 'Your saved sprite style could not be loaded. The choice below is this browser’s, not necessarily your account’s.',
  settings: {
    heading: 'Sprite style',
    descriptionSignedIn: 'Choose how Pokémon look across the site. It is saved to your account.',
  },
} as const;
