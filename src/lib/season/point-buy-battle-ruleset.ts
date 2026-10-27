/**
 * The battle ruleset of point-buy (`evolution_point_buy`) leagues (docs/evolution-point-buy.md).
 *
 * A point-buy league's league type is not a battle format: its battles are always Gen 9 singles,
 * with bans from the season's `format_rules`. Every phase (tournament) still needs a ruleset
 * (`tournamentCreateSchema.ruleset_id`), so league creation ensures one shared ruleset derived from
 * the pack and pins its head version as the league's default ruleset; the phase form preselects it.
 *
 * The ruleset is deliberately NON-custom (no `team_constraints`, no custom rules, no added Pokémon):
 * it is a base ruleset like a plain tier.
 *
 * It carries NO bans. `/api/validate-team` reads the version the phase pins and runs `validateTeam()`
 * against it, ANDed with the point-buy validator, which reads the season's `format_rules`
 * (`src/lib/draft/epb-team-validation.ts`). The ruleset is shared by every point-buy league, so any ban
 * on it would outlive a per-season ban edit (`PUT /api/seasons/[id]/format-rules`) and a pack change:
 * `format_rules` is the only source of point-buy bans. Its one clause (Item Clause) is also enforced by
 * the point-buy validator, so it can never reject a team the season accepts.
 *
 * Versions: clearing bans found on the shared ruleset publishes a NEW version. Leagues pin the
 * version they were created with, so a league that already pins a version with bans keeps them until
 * its pin moves (`POST /api/ruleset-definitions/[id]/pins`).
 */
import { formatPack } from '@/lib/format-pack';
import { createLegacyRuleset, updateLegacyRuleset } from '@/lib/ruleset-studio/legacy-bridge';
import { findHeadRulesetsByName } from '@/lib/supabase/queries/rulesets';
import type { Ruleset, RulesetFormData } from '@/types/ruleset';

/** Battle format of every point-buy league: Gen 9, singles. */
export const POINT_BUY_BASE_FORMAT = 'gen9';

/** The clauses the point-buy team validator enforces (`buildEpbRuleset`). */
export const POINT_BUY_CLAUSES: readonly string[] = ['Item Clause'];

/** The ruleset a point-buy league uses, built from the active format pack. */
export function pointBuyBattleRulesetInput(): RulesetFormData {
  return {
    // Ruleset names are stored once (not per locale); the pack's English name is the ruleset name.
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

/** True when the ruleset carries league-specific constraints (team constraints, custom rules or added Pokémon). */
function isCustom(ruleset: Ruleset): boolean {
  return (
    ruleset.team_constraints !== null ||
    ruleset.custom_rules_string.trim().length > 0 ||
    ruleset.additions.pokemon.length > 0
  );
}

/** True when an existing ruleset can serve as the point-buy battle ruleset. */
function isUsablePointBuyRuleset(ruleset: Ruleset): boolean {
  return ruleset.base_format === POINT_BUY_BASE_FORMAT && !ruleset.is_doubles && !isCustom(ruleset);
}

export interface EnsuredRuleset {
  ruleset: Ruleset;
  /** True when this call created the ruleset. */
  created: boolean;
  /** True when this call cleared bans found on a reused ruleset (it published a new version). */
  bansCleared: boolean;
}

/** True when the ruleset carries any ban list entry. */
function hasBans(ruleset: Ruleset): boolean {
  const { pokemon, moves, items, abilities } = ruleset.bans;
  return pokemon.length + moves.length + items.length + (abilities?.length ?? 0) > 0;
}

/**
 * The point-buy battle ruleset: the head of the oldest usable ruleset with the pack's name, or a new one.
 * Idempotent: a retry (or the next point-buy league) finds the ruleset instead of creating another.
 * It is reused as long as its head stays a Gen 9 singles, non-custom ruleset under the same name. Bans
 * found on a reused ruleset (created before bans moved to `format_rules` only, or added by hand) are
 * cleared in a new version, because they would reject teams the season's `format_rules` accept.
 */
export async function ensurePointBuyBattleRuleset(createdBy: string | null): Promise<EnsuredRuleset> {
  const input = pointBuyBattleRulesetInput();
  const existing = (await findHeadRulesetsByName(input.name)).find(isUsablePointBuyRuleset);
  if (existing) {
    if (!hasBans(existing)) return { ruleset: existing, created: false, bansCleared: false };
    const cleared = await updateLegacyRuleset(createdBy, existing.id, {
      banned_pokemon: [],
      banned_moves: [],
      banned_items: [],
      banned_abilities: [],
    });
    return { ruleset: cleared, created: false, bansCleared: true };
  }

  const ruleset = await createLegacyRuleset(createdBy, input);
  return { ruleset, created: true, bansCleared: false };
}
