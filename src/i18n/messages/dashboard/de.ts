import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  pageTitle: 'Dashboard',
  notRegistered: 'Du bist angemeldet, aber noch nicht als Spieler registriert. Bitte einen Admin, dich hinzuzufügen.',
  greeting: {
    morning: 'Guten Morgen, {name}!',
    afternoon: 'Guten Tag, {name}!',
    evening: 'Guten Abend, {name}!',
  },
  intro: 'Hier siehst du, was in deinen Ligen und Turnieren gerade los ist.',
  winStreak: '{n} Siege in Folge',
  editAvatar: 'Avatar bearbeiten',
  settings: 'Einstellungen',
  stats: {
    matches: 'Spiele',
    winRate: 'Siegquote',
    teams: 'Teams',
    rating: 'Rating',
  },
  now: {
    title: 'Aktuell',
    needAttention: {
      one: '{count} Spiel wartet auf dich',
      other: '{count} Spiele warten auf dich',
    },
    nothingNeeded: 'Gerade wartet nichts auf dich',
    allCaughtUp: 'Alles erledigt! Gerade wartet kein Spiel auf dich.',
    versus: 'vs. {name}',
    upcoming: 'Demnächst',
    scheduled: 'Angesetzt: {date}',
    planTeam: 'Team planen',
    submitResult: 'Ergebnis eintragen',
    confirmResult: 'Ergebnis bestätigen',
  },
  leagues: {
    title: 'Meine Ligen',
    standings: { one: '{count} Tabellenplatz', other: '{count} Tabellenplätze' },
    allLeagues: 'Alle Ligen',
    empty: 'Noch keine Tabellenplätze in aktiven Ligen.',
    rank: 'Platz <strong>{rank}</strong> von {total}<muted> · {wins}S–{losses}N</muted>',
    statsSoon: 'Statistiken folgen – noch keine abgeschlossenen Spiele.',
  },
  tournaments: {
    title: 'Meine Turniere',
    activeCount: '{count} aktiv',
    empty: 'Keine aktiven Turniere. Tritt einem bei und leg los!',
  },
  history: {
    title: 'Verlauf',
    summary: {
      one: '{wins}S–{losses}N · {count} Team',
      other: '{wins}S–{losses}N · {count} Teams',
    },
    recentMatches: 'Letzte Spiele',
    noCompleted: 'Noch keine abgeschlossenen Spiele.',
    myTeams: 'Meine Teams',
    newTeam: 'Neues Team',
    noTeams: 'Noch keine Teams. Bau dein erstes Team!',
    createTeam: 'Team erstellen',
    pokemonCount: '{count} Pokémon',
    locked: 'Gesperrt',
  },
});
