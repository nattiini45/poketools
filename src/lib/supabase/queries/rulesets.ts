import { supabase } from '../client';
import type { Json, Tables } from '@/types/database';
import type { Ruleset, RulesetFormData, BaseFormat, TeamConstraints } from '@/types/ruleset';

type RulesetRow = Tables<'rulesets'>;

function toRuleset(row: RulesetRow): Ruleset {
  return {
    id: row.id,
    name: row.name,
    base_format: row.base_format as BaseFormat,
    is_doubles: row.is_doubles,
    clauses: row.clauses,
    bans: {
      pokemon: row.banned_pokemon,
      moves: row.banned_moves,
      items: row.banned_items,
      abilities: row.banned_abilities ?? [],
    },
    additions: {
      pokemon: row.added_pokemon,
    },
    custom_rules_string: row.custom_rules_string,
    min_shared_type_pct: row.min_shared_type_pct ?? 0,
    team_constraints: (row.team_constraints as TeamConstraints | null) ?? null,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listRulesets(): Promise<Ruleset[]> {
  const { data, error } = await supabase
    .from('rulesets')
    .select('*')
    .order('name');

  if (error) throw error;
  return data.map(toRuleset);
}

export async function getRulesetById(id: string): Promise<Ruleset | null> {
  const { data, error } = await supabase
    .from('rulesets')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toRuleset(data) : null;
}

export async function createRuleset(
  input: RulesetFormData,
  createdBy: string | null
): Promise<Ruleset> {
  const { data, error } = await supabase
    .from('rulesets')
    .insert({
      name: input.name,
      base_format: input.base_format,
      is_doubles: input.is_doubles,
      clauses: input.clauses,
      banned_pokemon: input.banned_pokemon,
      banned_moves: input.banned_moves,
      banned_items: input.banned_items,
      banned_abilities: input.banned_abilities,
      added_pokemon: input.added_pokemon,
      custom_rules_string: input.custom_rules_string,
      min_shared_type_pct: input.min_shared_type_pct,
      team_constraints: (input.team_constraints ?? null) as Json | null,
      created_by: createdBy,
    })
    .select()
    .single();

  if (error) throw error;
  return toRuleset(data);
}

export async function updateRuleset(
  id: string,
  input: Partial<RulesetFormData>
): Promise<Ruleset> {
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.base_format !== undefined) updates.base_format = input.base_format;
  if (input.is_doubles !== undefined) updates.is_doubles = input.is_doubles;
  if (input.clauses !== undefined) updates.clauses = input.clauses;
  if (input.banned_pokemon !== undefined) updates.banned_pokemon = input.banned_pokemon;
  if (input.banned_moves !== undefined) updates.banned_moves = input.banned_moves;
  if (input.banned_items !== undefined) updates.banned_items = input.banned_items;
  if (input.banned_abilities !== undefined) updates.banned_abilities = input.banned_abilities;
  if (input.added_pokemon !== undefined) updates.added_pokemon = input.added_pokemon;
  if (input.custom_rules_string !== undefined) updates.custom_rules_string = input.custom_rules_string;
  if (input.min_shared_type_pct !== undefined) updates.min_shared_type_pct = input.min_shared_type_pct;
  if (input.team_constraints !== undefined) updates.team_constraints = input.team_constraints as Json | null;

  const { data, error } = await supabase
    .from('rulesets')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toRuleset(data);
}

export async function deleteRuleset(id: string): Promise<void> {
  const { error } = await supabase.from('rulesets').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Result of resolving the effective ruleset for a tournament or season.
 *
 * - `ruleset`  : the ruleset that should be enforced
 * - `rulesetId`: id of the resolved ruleset (may differ from the requested id)
 * - `source`   : where it came from, useful for logging / debugging
 * - `fellBack` : true when the resolver had to fall back to a base tier
 *                ruleset because no custom league ruleset could be matched
 */
export interface ResolvedRuleset {
  ruleset: Ruleset;
  rulesetId: string;
  /**
   * Where the resolved ruleset came from:
   *  - 'tournament' : matched via tournament.ruleset_id (custom or base)
   *  - 'season'     : matched via season.ruleset_id (custom)
   *  - 'name-match' : matched by name == season.name (custom)
   *  - 'fallback'   : tournament.ruleset_id but it is a base tier ruleset
   */
  source: 'tournament' | 'season' | 'name-match' | 'fallback';
  /** True when a base tier ruleset was used because no custom ruleset matched. */
  fellBack: boolean;
}

/**
 * True when a ruleset carries league-specific custom constraints
 * (team_constraints, custom_rules_string, or added_pokemon).
 *
 * Base tier rulesets in this app never set team_constraints,
 * custom_rules_string or added_pokemon — they only carry the standard
 * Smogon clauses/bans for the tier. Anything else is treated as a
 * "custom league" ruleset that MUST take precedence over the tier base.
 */
export function isCustomLeagueRuleset(ruleset: Ruleset): boolean {
  if (ruleset.team_constraints) return true;
  if (ruleset.custom_rules_string && ruleset.custom_rules_string.trim().length > 0) return true;
  const totalAdditions = ruleset.additions?.pokemon?.length ?? 0;
  return totalAdditions > 0;
}

interface ResolveInput {
  tournamentRulesetId: string | null;
  /**
   * Tournament bracket type. Used to gate the name-match fallback so it only
   * fires for group-phase tournaments (e.g. 'round_robin') and NEVER for
   * elimination-stage tournaments ('single_elim', 'double_elim'), which
   * legitimately want their own ruleset (often the base tier, e.g. when a
   * league's playoffs drop NFE / type-quota constraints for "fully RU").
   */
  tournamentBracketType?: string | null;
  season?: { id: string; name: string; rulesetId: string | null } | null;
}

/**
 * True for elimination-stage bracket types. These tournaments typically want
 * their own dedicated ruleset (often the base tier) and must NOT inherit the
 * season's group-phase custom ruleset via name-match fallback.
 */
function isPlayoffBracketType(bracketType: string | null | undefined): boolean {
  if (!bracketType) return false;
  const bt = bracketType.toLowerCase();
  return bt === 'single_elim' || bt === 'double_elim' || bt === 'swiss';
}

/**
 * Resolve the effective ruleset for a tournament, applying this precedence:
 *
 *   1. tournament.ruleset_id — if it is a CUSTOM league ruleset, use it.
 *   2. season.ruleset_id    — if it is a CUSTOM league ruleset, use it.
 *   3. Name-match: a ruleset whose `name` matches the season name AND is
 *      a CUSTOM ruleset — ONLY for group-phase brackets (round_robin etc.).
 *      Elim/single_elim brackets intentionally opt out so a season's
 *      playoffs can keep base-tier / fully-evolved rules.
 *   4. tournament.ruleset_id (base tier) — fallback, with a warning logged.
 *
 * The explicit precedence prevents a base tier ruleset (e.g. standard
 * 'Gen 9 RU') from silently overriding a tournament's dedicated custom
 * league ruleset (e.g. 'Type Triangle League'), while still respecting
 * intentional per-stage ruleset differences (group vs playoffs).
 *
 * If `season` is omitted we fall straight through to (1) and (4).
 */
export async function resolveEffectiveRuleset(
  input: ResolveInput
): Promise<ResolvedRuleset | null> {
  const { tournamentRulesetId, tournamentBracketType, season } = input;

  // 1. Tournament's own ruleset — if it's already custom, that's authoritative.
  if (tournamentRulesetId) {
    const tRuleset = await getRulesetById(tournamentRulesetId);
    if (tRuleset && isCustomLeagueRuleset(tRuleset)) {
      return {
        ruleset: tRuleset,
        rulesetId: tRuleset.id,
        source: 'tournament',
        fellBack: false,
      };
    }
  }

  // 2. Season's own ruleset — if it's custom, prefer it.
  if (season?.rulesetId) {
    const sRuleset = await getRulesetById(season.rulesetId);
    if (sRuleset && isCustomLeagueRuleset(sRuleset)) {
      return {
        ruleset: sRuleset,
        rulesetId: sRuleset.id,
        source: 'season',
        fellBack: false,
      };
    }
  }

  // 3. Name-based fallback: a ruleset whose `name` matches the season name
  //    AND carries custom constraints. This catches the data shape where the
  //    season/tournament both reference a base tier ruleset but a separate
  //    custom ruleset exists with the league's name (Type Triangle League).
  //
  //    Skipped for playoff brackets (single_elim / double_elim / swiss) so a
  //    season's playoffs can keep its own base-tier ruleset (e.g. "fully RU"
  //    instead of the group-phase NFE ruleset).
  const skipNameMatch = isPlayoffBracketType(tournamentBracketType);
  if (!skipNameMatch && season?.name) {
    const { data: nameMatches, error } = await supabase
      .from('rulesets')
      .select('*')
      .eq('name', season.name)
      .limit(5);
    if (error) {
      console.warn('[rulesets] name-match lookup failed:', error.message);
    } else if (nameMatches && nameMatches.length > 0) {
      for (const row of nameMatches) {
        const candidate = toRuleset(row);
        if (isCustomLeagueRuleset(candidate)) {
          console.warn(
            `[rulesets] Resolved custom ruleset "${candidate.name}" ` +
              `(id=${candidate.id}) by season name match ` +
              `(bracket=${tournamentBracketType ?? 'unknown'}). ` +
              `Tournament/season ruleset_id did not point to a custom ruleset.`
          );
          return {
            ruleset: candidate,
            rulesetId: candidate.id,
            source: 'name-match',
            fellBack: false,
          };
        }
      }
    }
  }

  // 4. Final fallback: tournament's base tier ruleset, with a clear warning.
  if (tournamentRulesetId) {
    const tRuleset = await getRulesetById(tournamentRulesetId);
    if (tRuleset) {
      const seasonHint = season?.name ? ` (season: ${season.name})` : '';
      const stageHint = tournamentBracketType ? ` [bracket=${tournamentBracketType}]` : '';
      console.warn(
        `[rulesets] Custom league ruleset not found for tournament${seasonHint}${stageHint}. ` +
          `Falling back to base tier ruleset "${tRuleset.name}" ` +
          `(id=${tRuleset.id}, base_format=${tRuleset.base_format}). ` +
          `League-specific constraints (type_quotas, NFE phase, custom bans) ` +
          `will NOT be enforced.`
      );
      return {
        ruleset: tRuleset,
        rulesetId: tRuleset.id,
        source: 'fallback',
        fellBack: true,
      };
    }
  }

  return null;
}
