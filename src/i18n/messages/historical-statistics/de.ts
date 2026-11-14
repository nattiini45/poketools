import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  "title": "Historische Abdeckung",
  "details": "Wettbewerbe und Zeiträume",
  "periods": {
    "first_half": "Erste Hälfte",
    "second_half": "Zweite Hälfte",
    "ko": "K.-o.-Phase",
    "playoff": "Playoffs",
    "single": "Einzelner Zeitraum"
  },
  "appearancesUnknown": "Team-Einsätze wurden nicht erfasst.",
  "archive": "Archiv",
  "selectedPlayerWithoutObservations": "Ausgewählter Spieler (keine einbezogenen Beobachtungen)",
  "noRecordedKos": "Keine erfassten KO-Summen für diesen Bereich.",
  "archiveMovesUnavailable": "Für archivierte Wettbewerbe wurde keine Attacken-Nutzung erfasst.",
  "ratingsLiveOnly": "Wertungen basieren nur auf Live-Spielen; historische Ergebnisse erzeugen keine Wertungen.",
  "streaksLiveOnly": "Serien basieren nur auf Live-Spielen; historische Ergebnisse erzeugen keine Serien.",
  "movesLiveOnly": "Die Attacken-Nutzung basiert nur auf Live-Kampfdaten.",
  "itemsLiveOnly": "Die Item-Nutzung basiert nur auf Live-Kampfdaten.",
  "loadFailed": "Statistiken konnten nicht geladen werden. Bitte wähle den Bereich erneut.",
  "excluded": "Nur Live-Daten. Historische Statistiken sind ausgeschlossen.",
  "not_ready": "Historische Daten sind noch nicht aktiviert.",
  "failed": "Historische Statistiken konnten nicht geladen werden.",
  "provenance": "Nutzung und Siegraten beziehen sich nur auf beobachtete Kämpfe mit zugeordneten Teams. Historische KOs decken mehr Quelldatensätze ab. Besiegt-Werte, Effizienz, Einsatz- und Lead-Raten bleiben auf Live-Daten beschränkt oder unbekannt.",
  "knownResults": "Bekannte Ergebniszeilen sind keine Gesamtzahl aller historischen Kämpfe; fehlende Zeiträume werden separat aufgeführt.",
  "notRecorded": "Nicht erfasst",
  "sourceCounts": "Live {live} · Historisch {historical}",
  "summary": "Bekannte Ergebniszeilen: {results} · Mögliche Kämpfe: {candidates} · Enthalten: {included} · Ausgeschlossen: {excluded} · Zurückgehalten: {withheld} · Nicht zugeordnete Teamdatensätze: {unmatched}",
  "period": "Zeitraum",
  "status": "Abdeckung",
  "recorded": "Erfasst",
  "missing": "Fehlt",
  "results": "Bekannte Ergebniszeilen",
  "included": "Enthaltene Kämpfe",
  "excludedBattles": "Ausgeschlossene Kämpfe",
  "withheld": "Zurückgehaltene Kämpfe",
  "noPeriods": "Keine erfassten Zeiträume verfügbar."
});
