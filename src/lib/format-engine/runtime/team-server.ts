/**
 * The team check of a kit league: the phase's pinned ruleset (`checkTeam`) merged with the stage's team constraints
 * (`evaluateConstraints`), the player's own resources and the unlocked domains. Server only: it reads the season's
 * runtime rows and resolves the team through the dex.
 *
 * It applies to a custom league on the `kit` engine whose phase stage has constraints, or whose format has domains or
 * resources (a stage without either has nothing to add). Any other league answers `applies: false` and the caller keeps
 * its own flow.
 */
import 'server-only';

import type { Ruleset } from '@/types/ruleset';
import type { PokemonSet, TeamValidationResult } from '@/types/team';
import { getNationalSpecies, getSpecies } from '@/lib/pkmn/dex';
import { toID } from '@/lib/pkmn/i18n/id';
import { readSet } from '@/lib/pkmn/validation';
import { checkTeam } from '@/lib/team/check.server';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { loadFreshKitContext, phaseById, type KitContext, type KitPhaseInfo } from './load';
import { evaluateConstraints, mergeConstraintIssues, type EvolutionClass, type TeamMember } from './team';

export interface EvaluateTeamInput {
  seasonId: string;
  /** The kit phase (a `tournaments` row) the team is for. */
  phaseId: string;
  playerId: string;
  roundNumber: number;
  pokemon: PokemonSet[];
  /** The phase's pinned ruleset when the caller has read it; omitted = read from the phase. */
  ruleset?: Ruleset | null;
}

export interface EvaluateTeamResult {
  applies: boolean;
  result: TeamValidationResult;
}

const NOT_APPLICABLE: TeamValidationResult = { valid: true, issues: [], team_issues: [] };

/** Whether the phase's stage or its format give the team check something to enforce beyond the ruleset. */
function hasKitRules(ctx: KitContext, phase: KitPhaseInfo): boolean {
  return (phase.stage.constraints?.length ?? 0) > 0 || (ctx.def.domains?.length ?? 0) > 0 || (ctx.def.resources?.length ?? 0) > 0;
}

function evolutionClass(nfe: boolean | undefined, tiers: readonly (string | undefined)[]): EvolutionClass {
  if (nfe !== true) return 'fe';
  return tiers.includes('LC') ? 'lc' : 'nfe';
}

/**
 * The team as the constraints read it, one member per slot (the issues index slots). A set that cannot be read is an
 * empty member: the ruleset check reports it, and it still counts toward the team size.
 */
export function resolveTeamMembers(pokemon: readonly PokemonSet[], gen: number, national: boolean): TeamMember[] {
  const members: TeamMember[] = [];
  for (const raw of pokemon) {
    const set = readSet(raw);
    if (set === null) {
      members.push({ name: '', species: '', baseName: '', baseSpecies: '', types: [], item: '', itemName: '', teraType: null, evolution: 'fe' });
      continue;
    }
    const species = national ? getNationalSpecies(set.species, gen) : getSpecies(set.species, gen);
    const id = toID(set.species);
    members.push({
      name: species?.name ?? set.species,
      species: species ? toID(species.name) : id,
      baseName: species?.baseSpecies ?? set.species,
      baseSpecies: species ? toID(species.baseSpecies ?? species.name) : id,
      types: species ? [...species.types] : [],
      item: toID(set.item),
      itemName: set.item,
      teraType: set.tera_type ? set.tera_type : null,
      evolution: species ? evolutionClass(species.nfe, [species.tier, species.natDexTier]) : 'fe',
    });
  }
  return members;
}

/** The round a team is checked for outside a match: the phase's latest round, or 1 before it has one. */
export async function currentPhaseRound(phaseId: string): Promise<number> {
  const rounds = await getRoundsByTournament(phaseId);
  return rounds.reduce((latest, round) => Math.max(latest, round.round_number), 1);
}

export async function evaluateTeam(input: EvaluateTeamInput): Promise<EvaluateTeamResult> {
  const ctx = await loadFreshKitContext(input.seasonId);
  const phase = ctx === null ? undefined : phaseById(ctx, input.phaseId);
  if (ctx === null || phase === undefined || !hasKitRules(ctx, phase)) return { applies: false, result: NOT_APPLICABLE };

  const [ruleset, season] = await Promise.all([
    input.ruleset !== undefined ? Promise.resolve(input.ruleset) : readPhaseRuleset(input.phaseId),
    getSeasonById(input.seasonId),
  ]);
  const base = await checkTeam({
    pokemon: input.pokemon,
    ruleset,
    // A phase whose pin cannot be read is a failed check, reported by checkTeam, never a silent downgrade.
    ...(ruleset === null ? { rulesetFailure: 'ruleset_not_found' as const, format: 'gen9' } : {}),
    playerId: input.playerId,
    seasonId: input.seasonId,
    season,
  });

  const members = resolveTeamMembers(input.pokemon, ruleset?.gen ?? 9, ruleset?.rules.universe === 'national');
  const issues = evaluateConstraints({
    constraints: phase.stage.constraints ?? [],
    def: ctx.def,
    state: ctx.state,
    seed: ctx.seed,
    playerId: input.playerId,
    round: input.roundNumber,
    members,
  });
  return { applies: true, result: mergeConstraintIssues(base, issues, members) };
}

async function readPhaseRuleset(phaseId: string): Promise<Ruleset | null> {
  const phase = await getTournamentById(phaseId);
  return phase ? getRulesetById(phase.ruleset_id) : null;
}
