import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  errorPage: {
    title: 'Da ist etwas schiefgelaufen',
    fallback: 'Ein unerwarteter Fehler ist aufgetreten.',
    retry: 'Erneut versuchen',
    back: 'Zurück',
  },
  notFound: {
    title: 'Seite nicht gefunden',
    body: 'Die Seite, die du suchst, gibt es nicht oder sie wurde verschoben.',
    home: 'Zur Startseite',
  },
  guards: {
    accessDenied: 'Kein Zugriff',
    adminOnly: 'Für diese Seite brauchst du Admin-Rechte.',
    creatorOnly: 'Für diese Seite brauchst du Creator-Rechte.',
  },
  session: {
    signIn: 'Anmelden',
    signOut: 'Abmelden',
  },
  theme: {
    toLight: 'Zum hellen Modus wechseln',
    toDark: 'Zum dunklen Modus wechseln',
  },
  pwa: {
    install: 'PokéTools-App installieren',
    iosHint: 'Für die App-Ansicht tippe in Safari auf „Teilen“ und dann auf „Zum Home-Bildschirm“.',
  },
  guest: 'Gast',
  admin: {
    navLabel: 'Admin',
    legacy: 'veraltet',
    groups: {
      competitions: 'Wettbewerbe',
      community: 'Community',
      system: 'System',
    },
    items: {
      leagues: 'Ligen',
      archivedLeagues: 'Archivierte Ligen',
      tournaments: 'Turniere',
      archivedTournaments: 'Archivierte Turniere',
      matches: 'Spiele',
      rulesets: 'Regelwerke',
      players: 'Spielerliste',
      achievements: 'Erfolge',
      wiki: 'Wiki-Moderation',
      social: 'Social-Integration',
      data: 'Datenwerkzeuge',
      metaData: 'Metadaten',
      audit: 'Protokoll',
      testPlayers: 'Testspieler',
      kale: 'Kale-Konsole',
    },
    matches: {
      status: {
        all: 'Alle',
        scheduled: 'Angesetzt',
        in_progress: 'Läuft',
        pending_confirmation: 'Wartet auf Bestätigung',
        completed: 'Beendet',
        disputed: 'Strittig',
      },
      searchPlaceholder: 'Spieler oder Spiel-ID suchen …',
      allTournaments: 'Alle Turniere',
      noSearchResults: 'Keine Spiele passen zu deiner Suche.',
      none: 'Keine Spiele gefunden.',
      versus: '{player1} vs. {player2}',
      winner: 'S: {name}',
      override: 'Korrigieren',
      submitResult: 'Ergebnis eintragen',
      viewPrep: 'Vorbereitung ansehen',
      summary: {
        one: '{count} Spiel – Seite {page} von {pages}',
        other: '{count} Spiele – Seite {page} von {pages}',
      },
      previous: 'Zurück',
      next: 'Weiter',
      loadFailed: 'Die Spiele konnten nicht geladen werden.',
    },
  },
});
