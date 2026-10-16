/**
 * Namespace `bracket` (T06): the words the bracket renderers and the phase
 * standings tables print. English is the wording these components always
 * showed, verbatim; the German comes from the reviewed plaza copy
 * (`src/lib/league-hub/copy.ts` DE_SHARED / DE.table).
 */
export default {
  /** Elimination bracket chrome (`BracketLabels`). */
  labels: {
    winnersBracket: 'Winners Bracket',
    losersBracket: 'Losers Bracket',
    grandFinals: 'Grand Finals',
    noRounds: 'No rounds generated yet.',
    /** An open slot or round with nobody in it yet. */
    tbd: 'TBD',
    /** "Match" in the skeleton card's accessible name ("Match 3 TBD"). */
    match: 'Match',
    /** The skeleton card's accessible name when it has no match number. */
    tbdMatch: 'TBD match',
    /** Double elimination: the short loss mark on a match card ("1 L"). */
    lossesShort: 'L',
    lossesEntering: 'Losses before this match',
  },
  /** The round robin results grid (`RoundRobinTableLabels`). */
  roundRobin: {
    player: 'Player',
    win: 'W',
    loss: 'L',
    draw: 'D',
  },
  /** Group and Swiss standings table headers. */
  standings: {
    player: 'Player',
    games: 'Games',
    wins: 'W',
    losses: 'L',
    draws: 'D',
    points: 'Pts',
    evolutionPoints: 'EP',
    killDiff: 'Kill Diff',
    buchholz: 'Buchholz',
    tie: 'Tie',
    tieTitle: 'Unresolved tie — decision match required',
  },
} as const;
