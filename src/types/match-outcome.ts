/**
 * How a match ended, next to who won it (`matches.winner_id`). One `match_outcomes` row per decided or
 * unresolvable match (migration `20261104090000_match_outcomes.sql`).
 *
 * - `p1_faints` / `p2_faints`: the Pokémon of player 1 / player 2 that fainted, summed over the match's games. Every
 *   fainted Pokémon counts, whatever caused it (recoil, hazards, Destiny Bond). NULL when unknown (an admin result
 *   without games) and always NULL for a forfeit, a no-show or an unresolved match.
 * - `unresolved`: the replay engine named no winner (an engine tie). The match is `disputed` and never scored.
 */
export const MATCH_OUTCOME_KINDS = ['played', 'forfeit', 'no_show', 'unresolved'] as const;
export type MatchOutcomeKind = (typeof MATCH_OUTCOME_KINDS)[number];

export const MATCH_OUTCOME_SOURCES = ['replay', 'manual', 'admin'] as const;
export type MatchOutcomeSource = (typeof MATCH_OUTCOME_SOURCES)[number];

/** The kinds an admin sets with `POST /api/admin/matches/[id]/result`. */
export const ADMIN_OUTCOME_KINDS = ['played', 'forfeit', 'no_show'] as const;
export type AdminOutcomeKind = (typeof ADMIN_OUTCOME_KINDS)[number];

export interface MatchOutcome {
  match_id: string;
  kind: MatchOutcomeKind;
  p1_faints: number | null;
  p2_faints: number | null;
  source: MatchOutcomeSource;
  /** Admin rows always carry one; unresolved rows carry the engine's code. Not public. */
  reason: string | null;
  /** Not public. */
  set_by: string | null;
  set_at: string;
}

export function isMatchOutcomeKind(value: unknown): value is MatchOutcomeKind {
  return typeof value === 'string' && (MATCH_OUTCOME_KINDS as readonly string[]).includes(value);
}

export function isMatchOutcomeSource(value: unknown): value is MatchOutcomeSource {
  return typeof value === 'string' && (MATCH_OUTCOME_SOURCES as readonly string[]).includes(value);
}
