/**
 * The battle ruleset of point-buy (`evolution_point_buy`) leagues (docs/evolution-point-buy.md).
 *
 * A point-buy league's league type is not a battle format: its battles are always Gen 9 singles,
 * with bans from the season's `format_rules`. Every phase (tournament) still needs a `rulesets` row
 * (`tournamentCreateSchema.ruleset_id`), so league creation ensures one shared row derived from
 * the pack and makes it the league's default ruleset; the phase form preselects it.
 *
 * The row is deliberately NON-custom (no `team_constraints`, `custom_rules_string` or
 * `added_pokemon`), so `isCustomLeagueRuleset` stays false and `resolveEffectiveRuleset` treats
 * it like a base ruleset.
 *
 * The row carries NO bans. `/api/validate-team` resolves it (step-4 fallback of
 * `resolveEffectiveRuleset`) and runs `validateTeam()` against it, ANDed with the point-buy
 * validator, which reads the season's `format_rules` (`src/lib/draft/epb-team-validation.ts`).
 * The row is shared by every point-buy league, so any ban on it would outlive a per-season ban
 * edit (`PUT /api/seasons/[id]/format-rules`) and a pack change: `format_rules` is the only
 * source of point-buy bans. Its one clause (Item Clause) is also enforced by the point-buy
 * validator, so it can never reject a team the season accepts.
 */
import { formatPack } from '@/lib/format-pack';
import {
  createRuleset,
  isCustomLeagueRuleset,
  listRulesetsByName,
  updateRuleset,
} from '@/lib/supabase/queries/rulesets';
import type { Ruleset, RulesetFormData } from '@/types/ruleset';

/** Battle format of every point-buy league: Gen 9, singles. */
export const POINT_BUY_BASE_FORMAT = 'gen9';

/** The clauses the point-buy team validator enforces (`buildEpbRuleset`). */
export const POINT_BUY_CLAUSES: readonly string[] = ['Item Clause'];

/** The ruleset row a point-buy league uses, built from the active format pack. */
export function pointBuyBattleRulesetInput(): RulesetFormData {
  return {
    // Ruleset names are stored once (not per locale); the pack's English name is the row name.
    name: formatPack.messages.en.leagueAdmin.form.battleRulesetName,
    base_format: POINT_BUY_BASE_FORMAT,
    is_doubles: false,
    clauses: [...POINT_BUY_CLAUSES],
    banned_pokemon: [],
    // Bans live in the season's format_rules only (see the module comment).
    banned_moves: [],
    banned_items: [],
    banned_abilities: [],
    added_pokemon: [],
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
  };
}

/** True when an existing row can serve as the point-buy battle ruleset. */
function isUsablePointBuyRuleset(ruleset: Ruleset): boolean {
  return (
    ruleset.base_format === POINT_BUY_BASE_FORMAT &&
    !ruleset.is_doubles &&
    !isCustomLeagueRuleset(ruleset)
  );
}

export interface EnsuredRuleset {
  ruleset: Ruleset;
  /** True when this call inserted the row. */
  created: boolean;
  /** True when this call cleared bans found on a reused row. */
  bansCleared: boolean;
}

/** True when the row carries any ban list entry. */
function hasBans(ruleset: Ruleset): boolean {
  const { pokemon, moves, items, abilities } = ruleset.bans;
  return pokemon.length + moves.length + items.length + (abilities?.length ?? 0) > 0;
}

/**
 * The point-buy battle ruleset: the oldest usable row with the pack's name, or a new one.
 * Idempotent: a retry (or the next point-buy league) finds the row instead of inserting another.
 * It is reused as long as it stays a Gen 9 singles, non-custom ruleset under the same name. Bans
 * found on a reused row (rows created before bans moved to `format_rules` only, or added by hand)
 * are cleared, because they would reject teams the season's `format_rules` accept.
 */
export async function ensurePointBuyBattleRuleset(createdBy: string | null): Promise<EnsuredRuleset> {
  const input = pointBuyBattleRulesetInput();
  const existing = (await listRulesetsByName(input.name)).find(isUsablePointBuyRuleset);
  if (existing) {
    if (!hasBans(existing)) return { ruleset: existing, created: false, bansCleared: false };
    const cleared = await updateRuleset(existing.id, {
      banned_pokemon: [],
      banned_moves: [],
      banned_items: [],
      banned_abilities: [],
    });
    return { ruleset: cleared, created: false, bansCleared: true };
  }

  const ruleset = await createRuleset(input, createdBy);
  return { ruleset, created: true, bansCleared: false };
}
