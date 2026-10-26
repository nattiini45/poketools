/**
 * The compile environment: what the surrounding product can do today.
 *
 * `CURRENT_ENV.matchModel` is the ONLY place the match-model limits are encoded. A match still needs a winner to
 * complete and finalize writes no draw, so draws and forfeits are refused and a match has two players. When the
 * match-model change lands, these three values flip here and nowhere else.
 */

export interface CompileEnv {
  matchModel: { draws: boolean; forfeits: boolean; maxPlayersPerMatch: number };
  features: { killStats: boolean; rating: boolean };
  /** Number of players on the roster, when the caller knows it. Roster stages start from this count. */
  rosterSize?: number;
  /** Ruleset ids that exist. When absent, `ruleset` references are not checked. */
  rulesetIds?: ReadonlySet<string>;
}

export const CURRENT_ENV: CompileEnv = {
  matchModel: { draws: false, forfeits: false, maxPlayersPerMatch: 2 },
  features: { killStats: true, rating: true },
};

/** Canonical string of an environment (sets sorted), used as part of the memo key. */
export function envKey(env: CompileEnv): string {
  const ids = env.rulesetIds === undefined ? null : [...env.rulesetIds].sort();
  return JSON.stringify([
    env.matchModel.draws,
    env.matchModel.forfeits,
    env.matchModel.maxPlayersPerMatch,
    env.features.killStats,
    env.features.rating,
    env.rosterSize ?? null,
    ids,
  ]);
}
