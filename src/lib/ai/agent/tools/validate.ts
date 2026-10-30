/**
 * Team-legality agent tool (PRD §5, Layer 1): `validateTeam`.
 *
 * A thin adapter over `checkTeam` (`src/lib/team/check.server.ts`), the same function behind the teambuilder's live
 * check (`POST /api/validate-team`) and the import preview, so "the agent says legal" means "the editor says legal".
 * That covers the league ruleset (or, with none, the FORMAT's catalog rules including its tier bans), the clauses,
 * learnsets and abilities, EV/IV/level ranges, duplicate moves, the assigned core, the drafted roster and the
 * Evolution Point Buy rules.
 *
 * The result says which rules ran (`ruleset_source`). A ruleset id that was asked for and could not be read is NOT a
 * silent fallback: the result is invalid and carries the `ruleset_load_failed` team issue.
 *
 * `player_id` and `season_id` are set by the server (`applyToolOverrides`), never trusted from the model: they scope
 * the roster, the assigned core and the Evolution Point Buy state to the authenticated player's own league.
 */
import type { PokemonSet, RulesetSource, StatSpread } from '@/types/team';
import type { Ruleset } from '@/types/ruleset';
import type { CoreTriple } from '@/types/season';
import { checkTeam, type RulesetFailure } from '@/lib/team/check.server';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import type { ValidateTeamInput } from './schemas';

export interface ValidateTeamIssue {
  pokemon_index: number;
  species: string;
  issue: string;
  severity: 'error' | 'warning';
}

export interface ValidateTeamResult {
  valid: boolean;
  format: string;
  issues: ValidateTeamIssue[];
  team_issues: string[];
  /** Which rules were enforced: the league's ruleset, the format's catalog rules, or only the generation. */
  ruleset_source: RulesetSource;
}

const ZERO_EVS: StatSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const MAX_IVS: StatSpread = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

function fillStats(partial: Partial<StatSpread> | undefined, base: StatSpread): StatSpread {
  return {
    hp: partial?.hp ?? base.hp,
    atk: partial?.atk ?? base.atk,
    def: partial?.def ?? base.def,
    spa: partial?.spa ?? base.spa,
    spd: partial?.spd ?? base.spd,
    spe: partial?.spe ?? base.spe,
  };
}

function toPokemonSet(set: ValidateTeamInput['team'][number]): PokemonSet {
  return {
    name: '',
    species: set.species,
    gender: '',
    item: set.item ?? '',
    ability: set.ability ?? '',
    evs: fillStats(set.evs, ZERO_EVS),
    ivs: fillStats(set.ivs, MAX_IVS),
    nature: set.nature ?? 'Hardy',
    level: set.level ?? 100,
    moves: set.moves,
    tera_type: set.teraType,
  };
}

/**
 * The real ruleset when `ruleset_id` is supplied and readable (through `readExposedRuleset`: only a ruleset meant to
 * be seen, never another admin's private draft). Otherwise null plus WHY, so the check reports the downgrade.
 */
async function readRuleset(
  rulesetId: string | undefined,
): Promise<{ ruleset: Ruleset | null; failure?: RulesetFailure }> {
  if (!rulesetId) return { ruleset: null };
  try {
    const found = await readExposedRuleset(rulesetId);
    return found ? { ruleset: found } : { ruleset: null, failure: 'ruleset_not_found' };
  } catch (err) {
    console.error('[agent/validateTeam] could not read the ruleset:', err);
    return { ruleset: null, failure: 'ruleset_load_failed' };
  }
}

export async function validateTeam(input: ValidateTeamInput): Promise<ValidateTeamResult> {
  // The schema refuses this too; a direct caller must not get a league check that silently drops the roster and core.
  if (input.season_id && !input.player_id) throw new Error('validateTeam: player_id is required with season_id');
  const { ruleset, failure } = await readRuleset(input.ruleset_id);
  const result = await checkTeam({
    pokemon: input.team.map(toPokemonSet),
    ruleset,
    rulesetFailure: failure,
    format: input.format,
    playerId: input.player_id ?? null,
    seasonId: input.season_id ?? null,
    // The core in the agent's context is the server's own read of the player's league; without one the check reads it.
    playerCore: input.player_core ? (input.player_core as CoreTriple) : undefined,
  });

  return {
    valid: result.valid,
    format: input.format,
    issues: result.issues.map((i) => ({
      pokemon_index: i.pokemon_index,
      species: i.species,
      issue: i.issue,
      severity: i.severity,
    })),
    team_issues: result.team_issues,
    ruleset_source: result.ruleset_source ?? { kind: 'format_basic', format: input.format },
  };
}
