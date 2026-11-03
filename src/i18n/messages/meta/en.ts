/** Site metadata (root layout `generateMetadata`, i18n-core §2.4). The title stays the brand; titleTemplate is the one suffix every page title gets. */
export default {
  title: 'PokéTools',
  titleTemplate: '%s | PokéTools',
  description: 'Competitive Pokémon league and tournament management',
  appleTitle: 'PokéTools',
  /** Page descriptions. A title is the entity's own name (the root template adds the brand); never put league, roster or participant data in a description. */
  entity: {
    pokemonDescription: '{name} is a {types} type Pokémon. Base stats, abilities, type matchups and usage in leagues.',
    summaryDescription: '{name}: {summary}',
    moveDescription: '{name} is a {type} type move. Power, accuracy and effect.',
    abilityDescription: '{name} is an ability. Its effect and the Pokémon that can have it.',
    itemDescription: '{name} is a held item. Its effect and details.',
    teraTitle: '{type} Tera Type',
    teraDescription: 'Type matchups for the {type} Tera Type: weaknesses, resistances and what it hits super effectively.',
  },
} as const;
