/**
 * Engine-label templates (i18n-core §5.1): the English names the engines
 * store in the DB, translated at display time by `translateEngineLabel`.
 * The en templates reproduce the stored text; writers are not changed.
 */
export default {
  round: {
    round: 'Round {n}',
    winnersRound: 'Winners Round {n}',
    losersRound: 'Losers Round {n}',
    winnersFinal: 'Winners Finals',
    losersFinal: 'Losers Finals',
    grandFinalReset: 'Grand Finals Reset',
    grandFinal: 'Grand Finals',
    final: 'Finals',
    semifinal: 'Semifinals',
    quarterfinal: 'Quarterfinals',
  },
  slot: {
    winnerOf: 'Winner of M{match}',
    loserOf: 'Loser of M{match}',
    seedLosers: 'Seed {seed} (LB)',
    seed: 'Seed {seed}',
    bye: 'BYE',
    ifNecessary: '{label} (if necessary)',
  },
  group: {
    group: 'Group {label}',
  },
  bracket: {
    fullBracket: 'Full bracket',
  },
  note: {
    autoConfirmed: 'Auto-confirmed after timeout.',
    rejectedByModerator: 'Rejected by moderator',
    adminCorrection: 'Admin correction',
  },
  actor: {
    system: 'System',
  },
} as const;
