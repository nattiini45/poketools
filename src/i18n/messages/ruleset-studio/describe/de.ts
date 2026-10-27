import { defineDe } from '@/i18n/define';
import type en from './en';

/** German for `ruleset-studio/describe`. Casual du. New German copy, not yet reviewed by a native speaker (`docs/i18n.md`). */
export default defineDe<typeof en>()({
  heading: {
    base: 'Basis',
    clauses: 'Klauseln',
    pokemon: 'Pokémon',
    moves: 'Attacken',
    items: 'Items',
    abilities: 'Fähigkeiten',
    constraints: 'Teamregeln',
    notes: 'Notizen',
  },
  base: {
    preset: 'Startet vom Regel-Preset {preset}.',
    blank: 'Startet von einer leeren Basis.',
    singles: 'Generation {gen}, Einzelkämpfe.',
    doubles: 'Generation {gen}, Doppelkämpfe.',
    standard: 'Pokémon, Attacken, Items und Fähigkeiten der Generation selbst sind erlaubt.',
    national: 'Der Nationaldex ist erlaubt: auch alles, was die Generation gestrichen hat.',
  },
  clauses: {
    none: 'Es gelten keine Klauseln.',
    list: 'Klauseln: {list}.',
    informational: 'Der Team-Validator prüft nur die Species Clause und die Item Clause. Die anderen Klauseln gelten im Kampf auf Showdown.',
  },
  list: {
    pokemon: {
      none: 'Es sind keine Pokémon gebannt.',
      block: { one: '{count} Pokémon ist gebannt: {list}.', other: '{count} Pokémon sind gebannt: {list}.' },
      allow: { one: 'Nur {count} Pokémon ist erlaubt: {list}.', other: 'Nur diese {count} Pokémon sind erlaubt: {list}.' },
    },
    moves: {
      none: 'Es sind keine Attacken gebannt.',
      block: { one: '{count} Attacke ist gebannt: {list}.', other: '{count} Attacken sind gebannt: {list}.' },
      allow: { one: 'Nur {count} Attacke ist erlaubt: {list}.', other: 'Nur diese {count} Attacken sind erlaubt: {list}.' },
    },
    items: {
      none: 'Es sind keine Items gebannt.',
      block: { one: '{count} Item ist gebannt: {list}.', other: '{count} Items sind gebannt: {list}.' },
      allow: { one: 'Nur {count} Item ist erlaubt: {list}.', other: 'Nur diese {count} Items sind erlaubt: {list}.' },
    },
    abilities: {
      none: 'Es sind keine Fähigkeiten gebannt.',
      block: { one: '{count} Fähigkeit ist gebannt: {list}.', other: '{count} Fähigkeiten sind gebannt: {list}.' },
      allow: { one: 'Nur {count} Fähigkeit ist erlaubt: {list}.', other: 'Nur diese {count} Fähigkeiten sind erlaubt: {list}.' },
    },
    more: '{names} und {count} weitere',
  },
  constraints: {
    sharedType: 'Mindestens {percent} % des Teams müssen einen Typ teilen.',
    typeQuotasCore: 'Typ-Quoten: mindestens {min} Pokémon von jedem Kerntyp des Spielers.',
    typeQuotasFixed: 'Typ-Quoten: mindestens {min} Pokémon von jedem dieser Typen: {types}.',
    teraCore: 'Tera-Typen müssen zu den Kerntypen des Spielers passen.',
    teraTeam: 'Tera-Typen müssen zu einem Typ im Team passen.',
    evolution: 'Entwicklungsstufe: nur nicht voll entwickelte Pokémon, dazu bis zu {cap} voll entwickelte.',
    evolutionUncapped: 'Entwicklungsstufe: nur nicht voll entwickelte Pokémon, dazu beliebig viele voll entwickelte.',
    eviolite: 'Evolith ist auf Pokémon bis Tier {tier} beschränkt.',
    none: 'Es gibt keine Teamregeln.',
  },
  notes: {
    none: 'Es gibt keine Notizen.',
  },
  coverage: {
    bans: { one: '{count} Ban', other: '{count} Bans' },
    clauses: { one: '{count} Klausel', other: '{count} Klauseln' },
    join: '{bans}, {clauses}',
  },
});
