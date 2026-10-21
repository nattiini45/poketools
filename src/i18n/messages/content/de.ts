import { defineDe } from '@/i18n/define';
import type en from './en';

// Patterns ported from the reviewed hub copy (`src/lib/league-hub/copy.ts` GERMAN_ROUND_NAMES / germanSlotLabel).
export default defineDe<typeof en>()({
  round: {
    round: 'Runde {n}',
    winnersRound: 'Gewinnerseite · Runde {n}',
    losersRound: 'Verliererseite · Runde {n}',
    winnersFinal: 'Gewinnerseite · Finale',
    losersFinal: 'Verliererseite · Finale',
    grandFinalReset: 'Großes Finale · Reset',
    grandFinal: 'Großes Finale',
    final: 'Finale',
    semifinal: 'Halbfinale',
    quarterfinal: 'Viertelfinale',
  },
  slot: {
    winnerOf: 'Sieger aus M{match}',
    loserOf: 'Verlierer aus M{match}',
    seedLosers: 'Setzplatz {seed} (Verliererseite)',
    seed: 'Setzplatz {seed}',
    bye: 'Freilos',
    ifNecessary: '{label} (falls nötig)',
  },
  group: {
    group: 'Gruppe {label}',
  },
  bracket: {
    fullBracket: 'Gesamter Turnierbaum',
  },
  note: {
    autoConfirmed: 'Nach Ablauf der Frist automatisch bestätigt.',
    rejectedByModerator: 'Von der Moderation abgelehnt',
    adminCorrection: 'Korrektur durch Admin',
  },
  actor: {
    system: 'System',
  },
});
