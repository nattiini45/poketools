import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  meta: {
    hubTitle: 'Creator Hub | PokeTools',
    studioTitle: 'Cast Studio | PokéTools',
    studioDescription: 'Erstelle und verwalte Broadcast-Sessions für Livecasts, Replaycasts und Solo-Streams',
    overlaysTitle: 'Overlay-Verwaltung | PokeTools',
  },
  nav: {
    studio: 'Studio',
    wiki: 'Wiki',
    overlays: 'Overlays',
  },
  hub: {
    title: 'Creator Hub',
    signInPrompt:
      'Melde dich an, um die Creator-Tools zu nutzen – verwalte Overlays, starte Cast-Sessions und erstelle Broadcast-Inhalte.',
    signIn: 'Anmelden',
    browseWiki: 'Zum Wiki',
    welcome: 'Willkommen zurück, {name}. Woran arbeitest du gerade?',
  },
  quickActions: {
    newSession: {
      title: 'Neue Cast-Session',
      description: 'Starte eine Live-Broadcast-Session mit Overlays und Steuerung.',
    },
    wiki: {
      title: 'Zum Wiki',
      description: 'Sieh dir Broadcast-Guides, Tipps und Dokumentation an und bearbeite sie.',
    },
    overlays: {
      title: 'Overlays verwalten',
      description: 'Erstelle, bearbeite und organisiere deine Overlay-Presets.',
    },
  },
  recentSessions: {
    title: 'Letzte Sessions',
    empty: 'Hier erscheinen deine letzten Sessions.',
  },
  overlayGallery: {
    title: 'Deine Overlay-Presets',
    empty: 'Hier erscheinen deine Overlay-Presets.',
  },
  overlaysPage: {
    title: 'Overlay-Verwaltung',
    comingSoon: 'Overlay-Verwaltung – kommt bald. Hier erscheinen deine gespeicherten Presets.',
    empty: 'Noch keine Overlay-Presets. Erstelle dein erstes Preset im Studio.',
  },
  studioPage: {
    title: 'Cast Studio',
  },
  toolsPage: {
    title: 'Cast-Tools',
    intro: 'Second-Screen-Tools für „{name}“. Lass diesen Tab neben dem Cast Studio geöffnet.',
  },
  broadcastHub: {
    title: 'Broadcast-Hub',
    notRegistered: 'Du bist nicht als Spieler registriert.',
    intro: 'Wähle ein Spiel aus, um den Live-Battle-Tracker zu öffnen. Aktive Spiele stehen oben.',
    activeMatches: 'Aktive Spiele',
    track: 'Tracken →',
    noActive: 'Keine aktiven Spiele zum Tracken.',
    recentlyCompleted: 'Kürzlich beendet',
    versus: 'vs.',
    winnerWon: '{name} hat gewonnen',
  },
  tracker: {
    title: 'Battle-Tracker',
    notRegistered: 'Du bist nicht als Spieler registriert.',
    matchNotFound: 'Spiel nicht gefunden.',
    notAuthorized: 'Du darfst diesen Tracker nicht ansehen.',
    backToHub: '← Zurück zum Broadcast-Hub',
    matchTitle: '{player1} vs. {player2}',
    subtitle: 'Live-Battle-Tracker',
  },
  cheatSheet: {
    title: 'Caster-Spickzettel',
    creatorRequired: 'Dafür brauchst du Creator-Zugriff.',
    matchNotFound: 'Spiel nicht gefunden.',
    back: '← Zurück',
  },
  broadcastError: {
    title: 'Fehler im Broadcast-Tracker',
    fallback: 'Im Broadcast-Tracker ist ein unerwarteter Fehler aufgetreten.',
    tryAgain: 'Erneut versuchen',
    goBack: 'Zurück',
  },
});
