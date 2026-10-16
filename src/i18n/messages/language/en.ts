/** Language picker and the "Keep Pokémon terms in English" setting (i18n-core §2.1). */
export default {
  legend: 'Language',
  /** aria-label of the NavBar trigger. */
  trigger: 'Language: {language}',
  /** Each language's own name (autonyms); identical in both dictionaries. */
  names: {
    en: 'English',
    de: 'Deutsch',
  },
  keepPkmnEnglish: 'Keep Pokémon terms in English',
  keepPkmnEnglishHint: 'Pokémon, moves, items, abilities and types keep their English names.',
  saving: 'Saving…',
  saveFailed: 'Your language setting could not be saved. Please try again.',
  settings: {
    heading: 'Language',
    description: 'Choose the language of the site. It is saved in this browser.',
  },
} as const;
