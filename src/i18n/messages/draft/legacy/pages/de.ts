import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  pointBuy: {
    notEpb: 'Diese Liga spielt nicht im Format Evolution Point Buy.',
  },
  matchup: {
    notAvailable: 'Für dieses Ligaformat gibt es keine Matchup-Analyse.',
    title: '{league} – Matchup-Analyse',
    intro: 'Vergleiche Kader, Typ-Matchups und Teamrollen.',
    introEpb: 'Vergleiche Kader, Typ-Matchups und Teamrollen. Berücksichtigt die aktuellen Entwicklungsstufen.',
    unsupported: {
      one: 'Der vollständige Kadervergleich ist derzeit nur für Evolution-Point-Buy-Ligen verfügbar. Die Teamrollen-Daten ({count} Eintrag) sind importiert und stehen bereit, sobald das Format freigeschaltet ist.',
      other:
        'Der vollständige Kadervergleich ist derzeit nur für Evolution-Point-Buy-Ligen verfügbar. Die Teamrollen-Daten ({count} Einträge) sind importiert und stehen bereit, sobald das Format freigeschaltet ist.',
    },
  },
});
