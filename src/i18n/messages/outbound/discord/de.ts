import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  watchReplay: 'Replay ansehen',
  gameHeader: '**Partie {n}:**',
  matchResult: {
    title: 'Ergebnis eingereicht – {tournament}',
  },
  matchConfirmed: {
    title: 'Spiel bestätigt – {tournament}',
  },
  matchDisputed: {
    title: 'Spiel angefochten – {tournament}',
    description:
      '**{disputer}** hat das Ergebnis zwischen **{player1}** und **{player2}** angefochten.\nEin Admin muss das klären.',
  },
  roundGenerated: {
    title: '{round} – {tournament}',
    description: {
      one: 'Neue Runde mit {count} Spiel ausgelost:',
      other: 'Neue Runde mit {count} Spielen ausgelost:',
    },
    pairing: '• {player1} vs. {player2}',
  },
  tournamentStarted: {
    title: 'Turnier gestartet – {tournament}',
    description: '**{tournament}** ist gestartet!',
  },
  tournamentCompleted: {
    title: 'Turnier beendet – {tournament}',
    description: '**{tournament}** ist vorbei. Die Endtabelle findest du auf der Seite!',
  },
  seasonAdvanced: {
    title: 'Nächste Phase – {season}',
    description: {
      one: '**{count}** Spieler ist von **{source}** in **{target}** weitergekommen.',
      other: '**{count}** Spieler sind von **{source}** in **{target}** weitergekommen.',
    },
  },
  draftPick: {
    title: 'Draft-Pick – {season}',
    description: '**{player}** hat **{pokemon}** gepickt',
    round: 'Runde',
    pickNumber: 'Pick-Nr.',
    upNext: '– du bist als Nächstes dran!',
    nextPick: 'Nächster Pick: {name}',
  },
  draftCompleted: {
    title: 'Draft abgeschlossen – {season}',
    description: 'Der Draft ist abgeschlossen ({pool})! Alle Picks sind vergeben.',
    format: '{order} · {pricing}',
    order: { snake: 'Snake-Reihenfolge', linear: 'Gleiche Reihenfolge', free: 'Freie Reihenfolge' },
    pricing: { none: 'ohne Punkte', fixed: 'feste Preise', auction: 'Auktionsgebote', pointBuy: 'Point Buy' },
  },
  achievementUnlocked: {
    title: 'Erfolg freigeschaltet – {tournament}',
    description: '{icon} **{player}** hat **{achievement}** freigeschaltet',
  },
  streakMilestone: {
    title: 'Serien-Meilenstein – {tournament}',
    win: '**{player}** hat eine Siegesserie von **{count}** Spielen!',
    ko: '**{player}** hat eine KO-Serie von **{count}** Spielen!',
    flawless: '**{player}** hat eine makellose Serie von **{count}** Spielen!',
  },
  streakBroken: {
    title: 'Serie gerissen – {tournament}',
    description: '**{breaker}** hat die Serie von **{player}** nach {count} Spielen beendet.',
  },
  ratingMilestone: {
    title: 'Rating-Meilenstein – {tournament}',
    description: '**{player}** hat **{rating}** erreicht ({threshold}).',
    threshold: {
      rising_star: 'Aufsteiger',
      ace_trainer: 'Ass-Trainer',
      elite_four: 'Top Vier',
      champion_tier: 'Champ-Klasse',
    },
  },
  roundCompleted: {
    title: '{round} abgeschlossen! – {tournament}',
    results: 'Ergebnisse',
    standings: 'Tabelle',
    points: '{points} Pkt.',
    more: '… und {count} weitere',
  },
  roundRecap: {
    title: 'Rundenrückblick: {round} – {tournament}',
    matchResults: 'Ergebnisse',
    playerSpotlight: 'Spieler im Fokus: {player}',
    metaTrends: 'Meta-Trends',
  },
  roundForecast: {
    title: 'Rundenvorschau: {round} – {tournament}',
    matchupPreviews: 'Matchup-Vorschau',
    boldPrediction: 'Gewagte Prognose',
  },
  matchCard: {
    confirmed: 'Bestätigt',
    winner: 'Sieger',
    mvp: 'MVP',
    fainted: 'Besiegt',
    kos: {
      one: '{count} KO',
      other: '{count} KOs',
    },
    totalKos: '{count} KOs',
  },
});
