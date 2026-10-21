/**
 * Shared Pokémon-data UI text (design pkmn-l10n.md §3.8). Pokémon names themselves never live here: they come
 * from `src/lib/pkmn/i18n/names`. `{ko}` is the Showdown token (OHKO, 2HKO, …), the same in both languages.
 */
export default {
  /** aria-label of a type icon; `{type}` is the localized type name. */
  typeAria: '{type} type',
  /** Tag next to a description that has no German game text. */
  descFallbackTag: 'EN',
  descFallbackTitle: 'No German game text exists; showing the English description.',
  /** Footer credit for the German Pokémon names (BSD-3-Clause clause 2). */
  attribution: 'German Pokémon data: PokéAPI (BSD-3-Clause)',
  ko: {
    guaranteed: 'guaranteed {ko}',
    /** `{percent}` is preformatted for the locale ("37.5%"). */
    chance: '{percent} chance to {ko}',
    possible: 'possible {ko}',
    /** The KO needs hazards or end-of-turn damage ("after Stealth Rock"). */
    conditional: '{text} (conditional)',
  },
} as const;
