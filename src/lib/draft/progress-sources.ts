/**
 * Evolution progress sources (draft-backend §7.6, §12.1; critique S9; SPEC
 * Prompt 6 §10–12 and Prompt 7). Client-safe and pure.
 *
 * DB columns keep their names (BR-14); the spec names live here:
 *
 * | spec                   | `evolution_tracker` column   |
 * |------------------------|------------------------------|
 * | self-earned kills      | `real_kills`                 |
 * | transferred progress   | `transferred_evo_progress`   |
 * | Draft Kill Token       | `draft_tokens`               |
 * | Comeback Token         | `kill_tokens`                |
 * | Participation Token    | `cosmo_points`               |
 *
 * Only `real_kills` is ever labelled kills/KOs (`displayKills`); the total
 * counts for evolution only and equals `tracker.total_kos` (M4 invariant).
 */

export interface ProgressSources {
  selfEarnedKills: number;
  transferred: number;
  draftKillToken: number;
  comebackToken: number;
  cosmoToken: number;
}

/** The tracker columns this module reads (`transferred_evo_progress` is null/absent before M4). */
export interface ProgressSourceColumns {
  real_kills: number;
  transferred_evo_progress?: number | null;
  draft_tokens: number;
  kill_tokens: number;
  cosmo_points: number;
}

/** Display order of the source chips. */
export const PROGRESS_SOURCE_ORDER: readonly (keyof ProgressSources)[] = Object.freeze([
  'selfEarnedKills',
  'transferred',
  'draftKillToken',
  'comebackToken',
  'cosmoToken',
] as const);

function amount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Maps tracker columns to the spec's five sources. */
export function progressSourcesOf(t: ProgressSourceColumns): ProgressSources {
  return {
    selfEarnedKills: amount(t.real_kills),
    transferred: amount(t.transferred_evo_progress),
    draftKillToken: amount(t.draft_tokens),
    comebackToken: amount(t.kill_tokens),
    cosmoToken: amount(t.cosmo_points),
  };
}

/** Total progress that counts for evolution; equals `tracker.total_kos`. Never label it kills. */
export function totalEligibleProgress(s: ProgressSources): number {
  return s.selfEarnedKills + s.transferred + s.draftKillToken + s.comebackToken + s.cosmoToken;
}

/** The ONLY tracker number labelled kills/KOs: match-earned kills of this line. */
export function displayKills(t: { real_kills: number }): number {
  return amount(t.real_kills);
}
