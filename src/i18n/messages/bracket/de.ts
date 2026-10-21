import { defineDe } from '@/i18n/define';
import type en from './en';

// Wording of the reviewed plaza copy (`src/lib/league-hub/copy.ts` DE_SHARED and DE.table).
export default defineDe<typeof en>()({
  labels: {
    winnersBracket: 'Gewinnerseite',
    losersBracket: 'Verliererseite',
    grandFinals: 'Großes Finale',
    noRounds: 'Noch keine Runden angelegt.',
    tbd: 'Offen',
    match: 'Spiel',
    tbdMatch: 'Offenes Spiel',
    lossesShort: 'N',
    lossesEntering: 'Niederlagen vor diesem Spiel',
  },
  roundRobin: {
    player: 'Spieler',
    win: 'S',
    loss: 'N',
    draw: 'U',
  },
  standings: {
    player: 'Spieler',
    games: 'Spiele',
    wins: 'S',
    losses: 'N',
    draws: 'U',
    points: 'Pkt.',
    evolutionPoints: 'EP',
    killDiff: 'Kill-Diff.',
    buchholz: 'Buchholz',
    tie: 'Gleichstand',
    tieTitle: 'Ungelöster Gleichstand – Entscheidungsspiel nötig',
  },
});
