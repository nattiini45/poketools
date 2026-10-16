import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  list: {
    title: 'Ligen',
    empty: 'Noch keine Ligen.',
    stages: { one: '{count} Phase', other: '{count} Phasen' },
  },
  error: {
    title: 'Liga konnte nicht geladen werden',
    description: 'Beim Laden dieser Liga ist ein unerwarteter Fehler aufgetreten.',
    goBack: 'Zurück',
  },
  detail: {
    pointBuy: 'Point-Buy-Liste',
    matchup: 'Matchup-Analyse',
    teams: 'Teams & Fortschritt',
    unknownPlayer: 'Unbekannter Spieler',
  },
  teams: {
    title: '{league}: Teams',
    registered: { one: '{count} angemeldetes Team', other: '{count} angemeldete Teams' },
    unknownPlayer: 'Unbekannter Spieler',
    empty: 'Noch keine Teams angemeldet.',
    hiddenSlot: 'Verborgen, bis dieser Spieler ein Spiel abgeschlossen hat',
    backToLeague: 'Zurück zur Liga',
  },
  team: {
    title: 'Team von {name}',
    hidden: 'Dieses Team bleibt verborgen, bis der Spieler ein Spiel abgeschlossen hat.',
    backToTeams: 'Zurück zu den Teams',
  },
});
