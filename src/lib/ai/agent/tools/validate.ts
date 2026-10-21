/**
 * Team-legality agent tool (PRD §5, Layer 1): `validateTeam`.
 *
 * Wraps `validateTeam` from `src/lib/pkmn/validation.ts` (species/move/item/
 * ability existence, bans, EV totals, clauses) and additionally runs the
 * existing `checkMoveLegality` learnset check so moves a species cannot learn
 * are surfaced too. Builds a minimal synthetic `Ruleset` from the format
 * string — the agent validates legality before any team is presented.
 */
import type { PokemonSet, StatSpread } from '@/types/team';
import type { Ruleset } from '@/types/ruleset';
import type { CoreTriple } from '@/types/season';
import { validateTeam as validateTeamCore } from '@/lib/pkmn/validation';
import { checkMoveLegality } from '@/lib/pkmn/dex';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { parseGenFromFormat } from './format';
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

/** Build a minimal standard Ruleset from a format string (e.g. "gen9ou"). */
function rulesetForFormat(format: string): Ruleset {
  return {
    id: 'agent-synthetic',
    name: format,
    base_format: format,
    is_doubles: /vgc|doubles|bss/i.test(format),
    clauses: ['Species Clause'],
    bans: { pokemon: [], moves: [], items: [], abilities: [] },
    additions: { pokemon: [] },
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
    created_by: null,
    created_at: '',
    updated_at: '',
  };
}

/**
 * Resolve the ruleset to validate against: the real league ruleset (with its
 * bans, clauses and team-constraints) when `ruleset_id` is supplied and loads,
 * otherwise a synthetic base-format ruleset. An unresolvable id soft-falls back
 * so a hallucinated id never breaks validation.
 */
async function resolveRuleset(input: ValidateTeamInput): Promise<Ruleset> {
  if (input.ruleset_id) {
    try {
      const real = await getRulesetById(input.ruleset_id);
      if (real) return real;
    } catch {
      // fall through to synthetic
    }
  }
  return rulesetForFormat(input.format);
}

export async function validateTeam(input: ValidateTeamInput): Promise<ValidateTeamResult> {
  const ruleset = await resolveRuleset(input);
  const gen = parseGenFromFormat(ruleset.base_format);
  const team = input.team.map(toPokemonSet);
  const playerCore = (input.player_core as CoreTriple | undefined) ?? null;

  const core = validateTeamCore(team, ruleset, { playerCore });
  const issues: ValidateTeamIssue[] = core.issues.map((i) => ({
    pokemon_index: i.pokemon_index,
    species: i.species,
    issue: i.issue,
    severity: i.severity,
  }));
  const teamIssues = [...core.team_issues];

  // Learnset legality — surface moves the species cannot legally learn.
  for (let i = 0; i < team.length; i++) {
    const set = team[i];
    const legality = await checkMoveLegality(set.species, set.moves, gen);
    for (const { move, legal } of legality) {
      if (!legal && move) {
        issues.push({
          pokemon_index: i,
          species: set.species,
          issue: `${set.species} cannot legally learn ${move}`,
          severity: 'error',
        });
      }
    }
  }

  const valid = issues.every((i) => i.severity !== 'error') && teamIssues.length === 0;
  return { valid, format: input.format, issues, team_issues: teamIssues };
}
