import { defineDe } from '@/i18n/define';
import type en from './en';

/** The tab names are the reviewed hub copy (`league-hub/copy.ts` DE_SHARED.insightsTabs). */
export default defineDe<typeof en>()({
  page: {
    title: 'Insights',
    globalTitle: 'Globale Insights',
    scopeNotFound: 'Bereich nicht gefunden.',
    loading: 'Insights werden geladen …',
    subtitle: 'Insights & Statistiken',
  },
  tabs: {
    ratings: 'Wertungen',
    usage: 'Pokémon-Nutzung',
    kills: 'Kill-Rangliste',
    moves: 'Attacken-Nutzung',
    h2h: 'Direkter Vergleich',
    streaks: 'Serien',
  },
  ratingsGlobalNote:
    'Spielerwertungen gelten global. Wechsle zum Bereich „Global“, um die Liga- und Turnierfilter der anderen Tabs zu ändern.',
  h2h: {
    player1: 'Spieler 1',
    player2: 'Spieler 2',
    selectPlayer: 'Spieler wählen',
    versus: 'vs.',
    prompt: 'Wähle zwei Spieler, um ihren direkten Vergleich zu sehen',
  },
  streaks: {
    empty: 'Noch keine Seriendaten.',
    winStreak: 'Siegesserie: {current} (Rekord {best})',
  },
  standings: 'Tabelle',
  scope: {
    global: 'Global (gesamte Zeit)',
    league: 'Liga',
    tournament: 'Turnier',
  },
  leaderboard: {
    title: 'Globale Wertungen',
    minGames: 'Min. Spiele',
    loading: 'Rangliste wird geladen …',
    empty: 'Noch keine gewerteten Spieler.',
    player: 'Spieler',
    rating: 'Wertung',
    peak: 'Höchstwert',
    record: 'Bilanz',
    signatures: 'Signature-Pokémon',
    recordValue: '{wins}-{losses}-{draws}',
  },
});
