import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  list: {
    title: 'Ligen',
    empty: 'Noch keine Ligen.',
    filterLabel: 'Nach Status filtern',
    filters: { all: 'Alle', active: 'Aktiv', upcoming: 'Bevorstehend', completed: 'Beendet' },
    emptyFiltered: 'Keine Ligen mit diesem Status.',
    showAll: 'Alle Ligen anzeigen',
    dateRange: '{start} – {end}',
    dateFrom: 'Ab {start}',
    stages: { one: '{count} Phase', other: '{count} Phasen' },
    testBadge: 'Testliga',
  },
  error: {
    title: 'Liga konnte nicht geladen werden',
    description: 'Beim Laden dieser Liga ist ein unerwarteter Fehler aufgetreten.',
    goBack: 'Zurück',
  },
  hero: {
    statusMatchday: '{status} · Spieltag {matchday}',
    lore: {
      evoliga: 'Plaza-Welt. Die Ostterrasse wartet noch auf ihren Champion.',
      sakura: 'Sakura-Park. Jedes Ergebnis hängt an der Bannerreihe unter dem Torii.',
      mountain: 'Bergpass. Die Ergebnisse stehen auf den Wegschildern bis hinauf zum Passtor.',
      clouds: 'Skyisle. Die Ansetzungen ziehen auf dem Luftschiff vorbei, das Halo-Tor hütet die Regeln.',
    },
    stats: {
      trainers: { one: 'Trainer', other: 'Trainer' },
      matchesPlayed: { one: 'Spiel gespielt', other: 'Spiele gespielt' },
      daysLeft: { one: 'Tag übrig', other: 'Tage übrig' },
      daysToStart: { one: 'Tag bis zum Start', other: 'Tage bis zum Start' },
    },
    match: { yours: 'Dein nächstes Spiel', live: 'Läuft gerade', next: 'Nächstes Spiel' },
    leader: { leading: 'Tabellenspitze', champion: 'Champion' },
    standing: 'Platz {rank} · {points} Pkt.',
    vs: 'VS',
    actions: { submit: 'Ergebnis melden', prep: 'Spielvorbereitung', open: 'Zum Spiel' },
  },
  detail: {
    pointBuy: 'Point-Buy-Liste',
    matchup: 'Matchup-Analyse',
    teams: 'Teams & Fortschritt',
  },
  teams: {
    title: '{league}: Teams',
    registered: { one: '{count} angemeldetes Team', other: '{count} angemeldete Teams' },
    unknownPlayer: 'Unbekannter Spieler',
    empty: 'Noch keine Teams angemeldet.',
    hiddenSlot: 'Verborgen, bis ein Spiel mit diesem Team abgeschlossen ist',
    backToLeague: 'Zurück zur Liga',
  },
  team: {
    title: 'Team von {name}',
    hidden: 'Dieses Team bleibt verborgen, bis ein Spiel mit ihm abgeschlossen ist.',
    backToTeams: 'Zurück zu den Teams',
  },
});
