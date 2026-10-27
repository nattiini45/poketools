/**
 * Namespace `ruleset-studio/describe`: the sentences of the rules text (`src/lib/ruleset-kit/describe.ts`), which turns the
 * effective rules of a ruleset into plain language for the editor's Rules text tab and, later, the public rules page.
 * Count-bearing sentences are `{one, other}` forms read from a `count` param. Pokémon, move, item, ability and type names
 * are filled in from the name layer by the caller; Showdown clause names stay English.
 */
export default {
  heading: {
    base: 'Base',
    clauses: 'Clauses',
    pokemon: 'Pokémon',
    moves: 'Moves',
    items: 'Items',
    abilities: 'Abilities',
    constraints: 'Team rules',
    notes: 'Notes',
  },
  base: {
    preset: 'Starts from the rule preset {preset}.',
    blank: 'Starts from a blank base.',
    singles: 'Generation {gen}, singles.',
    doubles: 'Generation {gen}, doubles.',
    standard: 'Pokémon, moves, items and abilities of the generation itself are legal.',
    national: 'The National Dex is legal: everything the generation dropped, too.',
  },
  clauses: {
    none: 'No clauses apply.',
    list: 'Clauses: {list}.',
    informational: 'The team validator checks only the Species Clause and the Item Clause. The other clauses apply in the battle on Showdown.',
  },
  list: {
    pokemon: {
      none: 'No Pokémon are banned.',
      block: { one: '{count} Pokémon is banned: {list}.', other: '{count} Pokémon are banned: {list}.' },
      allow: { one: 'Only {count} Pokémon is legal: {list}.', other: 'Only these {count} Pokémon are legal: {list}.' },
    },
    moves: {
      none: 'No moves are banned.',
      block: { one: '{count} move is banned: {list}.', other: '{count} moves are banned: {list}.' },
      allow: { one: 'Only {count} move is legal: {list}.', other: 'Only these {count} moves are legal: {list}.' },
    },
    items: {
      none: 'No items are banned.',
      block: { one: '{count} item is banned: {list}.', other: '{count} items are banned: {list}.' },
      allow: { one: 'Only {count} item is legal: {list}.', other: 'Only these {count} items are legal: {list}.' },
    },
    abilities: {
      none: 'No abilities are banned.',
      block: { one: '{count} ability is banned: {list}.', other: '{count} abilities are banned: {list}.' },
      allow: { one: 'Only {count} ability is legal: {list}.', other: 'Only these {count} abilities are legal: {list}.' },
    },
    more: '{names}, and {count} more',
  },
  constraints: {
    sharedType: 'At least {percent}% of the team must share a type.',
    typeQuotasCore: 'Type quotas: at least {min} Pokémon of each of the player’s core types.',
    typeQuotasFixed: 'Type quotas: at least {min} Pokémon of each of these types: {types}.',
    teraCore: 'Tera types must match the player’s core types.',
    teraTeam: 'Tera types must match a type on the team.',
    evolution: 'Evolution stage: only Pokémon that are not fully evolved, plus up to {cap} fully evolved.',
    evolutionUncapped: 'Evolution stage: only Pokémon that are not fully evolved, plus any number of fully evolved ones.',
    eviolite: 'Eviolite is limited to Pokémon of tier {tier} or lower.',
    none: 'There are no team rules.',
  },
  notes: {
    none: 'There are no notes.',
  },
  coverage: {
    bans: { one: '{count} ban', other: '{count} bans' },
    clauses: { one: '{count} clause', other: '{count} clauses' },
    join: '{bans}, {clauses}',
  },
} as const;
