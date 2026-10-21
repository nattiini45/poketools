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
    count: { one: '{count} Liga', other: '{count} Ligen' },
    allLeagues: 'Alle Ligen',
    empty: 'Du bist noch keiner Liga beigetreten.',
    rank: 'Platz <strong>{rank}</strong> von {total}<muted> · {wins}S–{losses}N</muted>',
    statsSoon: 'Statistiken folgen – noch keine abgeschlossenen Spiele.',
    noFinalStanding: 'Kein Endstand erfasst.',
  },
  tournaments: {
    title: 'Meine Turniere',
    count: { one: '{count} Turnier', other: '{count} Turniere' },
    empty: 'Noch keine Turniere. Tritt einem bei und leg los!',
  },
  history: {
    title: 'Verlauf',
    summary: {
      one: '{wins}S–{losses}N · {count} Team',
      other: '{wins}S–{losses}N · {count} Teams',
    },
    recentMatches: 'Letzte Spiele',
    noCompleted: 'Noch keine abgeschlossenen Spiele.',
    teamsUsed: 'Gespielte Teams',
    teambuilder: 'Teambuilder',
    noTeamsUsed: 'Für deine Spiele sind noch keine Kampfstatistiken erfasst.',
    kindLeague: 'Liga',
    kindTournament: 'Turnier',
    pokemonCount: '{count} Pokémon eingesetzt',
    brought: '{name} ×{count}',
  },
});
