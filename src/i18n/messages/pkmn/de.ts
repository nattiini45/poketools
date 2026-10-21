import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  typeAria: 'Typ {type}',
  descFallbackTag: 'EN',
  descFallbackTitle: 'Für diesen Eintrag gibt es keinen deutschen Spieltext, darum siehst du die englische Beschreibung.',
  attribution: 'Deutsche Pokémon-Daten: PokéAPI (BSD-3-Clause)',
  ko: {
    guaranteed: 'garantierter {ko}',
    chance: '{percent} Chance auf {ko}',
    possible: 'möglicher {ko}',
    conditional: '{text} (bedingt)',
  },
});
