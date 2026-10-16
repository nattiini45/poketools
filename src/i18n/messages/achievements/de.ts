import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  first_win: { name: 'Erster Sieg', description: 'Gewinne dein erstes Spiel.' },
  ten_wins: { name: 'Zweistellig', description: 'Erreiche insgesamt 10 Siege in deiner Karriere.' },
  fifty_wins: { name: 'Trainer-Veteran', description: 'Erreiche insgesamt 50 Siege in deiner Karriere.' },
  hundred_wins: { name: 'Lebende Legende', description: 'Erreiche insgesamt 100 Siege in deiner Karriere.' },
  clean_sweep: { name: 'Sauberer Sweep', description: 'Erziele 6 oder mehr KOs in einem einzigen Spiel.' },
  flawless: { name: 'Makelloser Sieg', description: 'Gewinne ein Spiel, ohne ein Pokémon zu verlieren.' },
  giant_killer: {
    name: 'Riesentöter',
    description: 'Besiege einen Gegner, dessen Setzplatz mindestens 4 Plätze über deinem liegt.',
  },
  streak_5: { name: 'Feuer und Flamme', description: 'Erreiche eine Siegesserie von 5 Spielen.' },
  streak_10: { name: 'Unaufhaltsam', description: 'Erreiche eine Siegesserie von 10 Spielen.' },
  collector_25: {
    name: 'Pokémon-Sammler',
    description: 'Setze in deiner Karriere mindestens 25 verschiedene Pokémon ein.',
  },
  collector_50: {
    name: 'Pokémon-Professor',
    description: 'Setze in deiner Karriere mindestens 50 verschiedene Pokémon ein.',
  },
  collector_100: {
    name: 'Lebender Pokédex',
    description: 'Setze in deiner Karriere mindestens 100 verschiedene Pokémon ein.',
  },
  iron_wall: { name: 'Eiserne Mauer', description: 'Gewinne 3 Spiele in Folge, ohne ein Pokémon zu verlieren.' },
  ko_machine: {
    name: 'KO-Maschine',
    description: 'Erreiche eine KO-Serie von 5 Spielen (mindestens 3 KOs pro Spiel).',
  },
  tournament_champ: { name: 'Turnier-Champion', description: 'Gewinne ein Turnierfinale.' },
  back_to_back: { name: 'Titel in Serie', description: 'Gewinne mehrere Turnierfinals hintereinander.' },
});
