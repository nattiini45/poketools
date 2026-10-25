import type { BoOverrides, BracketType, TeamVisibility, Tournament, TournamentFormData } from '@/types/tournament';

/** The tournament fields the standalone settings form reads and writes. */
export type TournamentSettingsSource = Pick<
  Tournament,
  | 'name'
  | 'bracket_type'
  | 'ruleset_id'
  | 'best_of_default'
  | 'bo_overrides'
  | 'is_doubles'
  | 'team_visibility'
  | 'bracket_reset_enabled'
>;

/** Which fields the started-tournament lock freezes (the server refuses a changed value). */
export interface TournamentSettingsLocks {
  bracketType: boolean;
  ruleset: boolean;
  doubles: boolean;
}

/** Body of PATCH /api/tournaments/[id] built from a settings edit: changed keys only. */
export interface TournamentUpdatePatch {
  name?: string;
  bracket_type?: BracketType;
  ruleset_id?: string;
  best_of_default?: number;
  bo_overrides?: BoOverrides;
  is_doubles?: boolean;
  team_visibility?: TeamVisibility;
  bracket_reset_enabled?: boolean;
}

/** Positive overrides only, keys sorted: the form drops 0 (= default) the same way. */
function effectiveOverrides(overrides: BoOverrides | undefined): BoOverrides {
  const entries = Object.entries(overrides ?? {})
    .filter(([, value]) => value > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}

function sameOverrides(a: BoOverrides, b: BoOverrides): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Turns a submitted settings form into the PATCH body: only the keys that
 * differ from the stored tournament. A locked field is never emitted, even
 * when its control changed. `bo_overrides` is compared as an effective map
 * and an emptied map is sent as `{}` (the form submits `undefined` for
 * "none", which the endpoint would ignore). `bracket_reset_enabled` only
 * applies to a double-elimination bracket. Returns `{}` when nothing changed.
 */
export function buildTournamentPatch(
  initial: TournamentSettingsSource,
  submitted: TournamentFormData,
  locked: TournamentSettingsLocks,
): TournamentUpdatePatch {
  const patch: TournamentUpdatePatch = {};

  const name = submitted.name.trim();
  if (name !== initial.name.trim()) patch.name = name;

  if (!locked.bracketType && submitted.bracket_type !== initial.bracket_type) {
    patch.bracket_type = submitted.bracket_type;
  }
  if (!locked.ruleset && submitted.ruleset_id !== initial.ruleset_id) {
    patch.ruleset_id = submitted.ruleset_id;
  }
  if (submitted.best_of_default !== initial.best_of_default) {
    patch.best_of_default = submitted.best_of_default;
  }

  const nextOverrides = effectiveOverrides(submitted.bo_overrides);
  if (!sameOverrides(effectiveOverrides(initial.bo_overrides), nextOverrides)) {
    patch.bo_overrides = nextOverrides;
  }

  if (!locked.doubles && submitted.is_doubles !== initial.is_doubles) {
    patch.is_doubles = submitted.is_doubles;
  }
  if (submitted.team_visibility !== initial.team_visibility) {
    patch.team_visibility = submitted.team_visibility;
  }

  const finalBracketType = locked.bracketType ? initial.bracket_type : submitted.bracket_type;
  if (
    finalBracketType === 'double_elim' &&
    submitted.bracket_reset_enabled !== undefined &&
    submitted.bracket_reset_enabled !== (initial.bracket_reset_enabled ?? true)
  ) {
    patch.bracket_reset_enabled = submitted.bracket_reset_enabled;
  }

  return patch;
}
