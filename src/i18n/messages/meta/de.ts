import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  title: 'PokéTools',
  titleTemplate: '%s | PokéTools',
  description: 'Verwaltung für kompetitive Pokémon-Ligen und -Turniere',
  appleTitle: 'PokéTools',
  entity: {
    pokemonDescription: '{name} ist ein Pokémon vom Typ {types}. Basiswerte, Fähigkeiten, Typ-Matchups und Nutzung in Ligen.',
    summaryDescription: '{name}: {summary}',
    moveDescription: '{name} ist eine Attacke vom Typ {type}. Stärke, Genauigkeit und Effekt.',
    abilityDescription: '{name} ist eine Fähigkeit. Ihr Effekt und die Pokémon, die sie haben können.',
    itemDescription: '{name} ist ein Item zum Tragen. Effekt und Details.',
    teraTitle: 'Tera-Typ {type}',
    teraDescription: 'Typ-Matchups für den Tera-Typ {type}: Schwächen, Resistenzen und gegen welche Typen er sehr effektiv ist.',
  },
});
