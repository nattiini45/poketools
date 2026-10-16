/**
 * Server-side EPB team validation (suspension enforcement, line presence,
 * format_rules bans + stage-aware tera enforcement).
 */

import { getPlayerTrackers } from '@/lib/supabase/queries/evolutions';
import { getSeasonLineThresholds, type LineThresholds } from '@/lib/draft/epb-thresholds';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { lineLookup, resolveEpbStage } from '@/lib/match/epb-stage-resolution';
import { codedIssue, validateTeam } from '@/lib/pkmn/validation';
import { getSpecies } from '@/lib/pkmn/dex';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { PokemonSet, TeamValidationResult } from '@/types/team';
import type { Ruleset } from '@/types/ruleset';
import type { TeraRules } from '@/types/format-rules';
import { DEFAULT_TERA_RULES, DEFAULT_BANNED_MOVES, DEFAULT_BANNED_ITEMS } from '@/types/format-rules';

/** Collect all species forms for an evolution line. */
export function collectLineForms(
  line: LineThresholds,
  lockedStage3?: string | null
): Set<string> {
  return new Set([
    line.base_pokemon,
    line.stage2_pokemon,
    ...(line.stage3_pokemon ? [line.stage3_pokemon] : []),
    ...(lockedStage3 ? [lockedStage3] : []),
  ]);
}

/** True when any form of the line appears in battle stats for the player. */
export function wasLineBroughtInMatch(
  playerId: string,
  line: LineThresholds,
  battleStats: { player_id: string; pokemon_name: string }[],
  lockedStage3?: string | null
): boolean {
  const forms = collectLineForms(line, lockedStage3);
  return battleStats.some(
    (stat) => stat.player_id === playerId && forms.has(stat.pokemon_name)
  );
}

/**
 * Reject a submitted team that includes a line suspended on `matchday`.
 * Throws UserFacingError with a player-facing message.
 */
export async function assertNoSuspendedLinesInTeam(
  seasonId: string,
  playerId: string,
  matchday: number,
  pokemon: PokemonSet[]
): Promise<void> {
  const [trackers, lines] = await Promise.all([
    getPlayerTrackers(seasonId, playerId),
    getSeasonLineThresholds(seasonId),
  ]);

  const lineOf = lineLookup(lines);
  const speciesInTeam = new Set(pokemon.map((set) => set.species));

  for (const tracker of trackers) {
    if (tracker.suspended_until_matchday !== matchday) continue;

    const line = lineOf(tracker);
    if (!line) continue;

    const forms = collectLineForms(line, tracker.locked_stage3_pokemon);
    for (const species of speciesInTeam) {
      if (forms.has(species)) {
        throw new UserFacingError(
          `${species} is suspended for matchday ${matchday} and cannot be included in the final team`,
          { status: 400, code: 'suspended_line_in_team' }
        );
      }
    }
  }
}

// ── format_rules enforcement (banned moves/items + stage-aware tera) ────

/**
 * Build a minimal `Ruleset` fragment that reuses the existing `validateTeam`
 * core for move/item bans and Item-Clause matching. Only the fields the core
 * actually reads are populated meaningfully; everything else is a neutral
 * default so the object satisfies the `Ruleset` type.
 */
function buildEpbRuleset(bannedMoves: string[], bannedItems: string[]): Ruleset {
  return {
    id: 'epb',
    name: 'Evolution Point Buy',
    base_format: 'gen9',
    is_doubles: false,
    clauses: ['Item Clause'],
    bans: {
      pokemon: [],
      moves: bannedMoves,
      items: bannedItems,
      abilities: [],
    },
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
 * Pure, DB-free EPB team validation.
 *
 * 1. Reuses the existing `validateTeam` core for banned move/item matching
 *    and Item-Clause enforcement (no duplicated ban logic).
 * 2. Adds an EPB-specific stage-aware tera check the core cannot do: per-slot
 *    tera eligibility depends on the team member's current EPB stage.
 *
 * `stageByIndex` is aligned to `pokemon`. A `null` entry means the slot's
 * stage could not be resolved (e.g. a non-drafted species) — tera is skipped
 * for that slot. Stage 3's `'none'` tera rule is intentionally NOT enforced
 * here: it is a battle-runtime rule (the species may not tera at all during
 * battle), not a team-build constraint, so there is nothing to validate at
 * submission time. Sleep Clause is likewise a battle-runtime rule.
 */
export function validateEpbTeam(
  pokemon: PokemonSet[],
  opts: {
    bannedMoves: string[];
    bannedItems: string[];
    teraRules: TeraRules;
    /** Current EPB stage (1|2|3) per team index, aligned to `pokemon`; null = unresolved (skip tera check for that slot). */
    stageByIndex: (1 | 2 | 3 | null)[];
  },
): TeamValidationResult {
  const ruleset = buildEpbRuleset(opts.bannedMoves, opts.bannedItems);
  const base = validateTeam(pokemon, ruleset);

  const issues = base.issues;
  const teamIssues = base.team_issues;

  for (let i = 0; i < pokemon.length; i++) {
    const set = pokemon[i];
    const stage = opts.stageByIndex[i] ?? null;

    // Only a 'stab_only' stage is a team-build constraint: 'any' is unrestricted
    // and 'none' is a battle-runtime rule (see comment above); null = unresolved, skip.
    if (stage === null) continue;
    if (opts.teraRules[`stage${stage}` as const] !== 'stab_only') continue;
    if (!set.tera_type) continue;

    const species = getSpecies(set.species, 9);
    if (!species) continue; // unknown species is already flagged by the core

    if (!(species.types as readonly string[]).includes(set.tera_type)) {
      issues.push({
        pokemon_index: i,
        species: species.name,
        issue: `Stage ${stage} STAB-only tera: ${set.tera_type} is not one of ${species.name}'s types (${species.types.join(' / ')})`,
        severity: 'error',
        // Stage 2 keeps its original code, so stored and rendered stage-2 issues are unchanged.
        ...(stage === 2
          ? codedIssue('epb_stage2_tera', { type: set.tera_type, species: species.name, types: species.types.join('/') })
          : codedIssue('epb_stage_tera', { stage, type: set.tera_type, species: species.name, types: species.types.join('/') })),
      });
    }
  }

  const valid = issues.every((issue) => issue.severity !== 'error') && teamIssues.length === 0;
  return { valid, issues, team_issues: teamIssues, team_issue_details: base.team_issue_details };
}

/**
 * Resolve the EPB stage (1|2|3) for each team member, aligned to `pokemon`.
 * A member whose species matches no drafted line gets `null` (unresolved).
 */
function resolveStageByIndex(
  pokemon: PokemonSet[],
  trackers: {
    line_id?: string | null;
    base_pokemon: string;
    total_kos: number;
    locked_stage3_pokemon: string | null;
  }[],
  lines: LineThresholds[],
): (1 | 2 | 3 | null)[] {
  const lineOf = lineLookup(lines);

  return pokemon.map((set) => {
    for (const tracker of trackers) {
      const line = lineOf(tracker);
      if (!line) continue;
      const forms = collectLineForms(line, tracker.locked_stage3_pokemon);
      if (forms.has(set.species)) {
        return resolveEpbStage(line, tracker.total_kos, tracker.locked_stage3_pokemon).stage as 1 | 2 | 3;
      }
    }
    return null;
  });
}

/**
 * Validate an EPB team against the season's `format_rules` (banned moves/items,
 * stage-aware tera). Non-throwing variant for UX routes that want the
 * granular `TeamValidationResult` instead of an exception.
 *
 * Sleep Clause and stage-3 tera ('none') are battle-runtime rules and are
 * intentionally NOT enforced here — they have no representation at team-build
 * time.
 */
export async function validateEpbTeamForSeason(
  seasonId: string,
  playerId: string,
  pokemon: PokemonSet[],
): Promise<TeamValidationResult> {
  const [formatRules, trackers, lines] = await Promise.all([
    getFormatRules(seasonId),
    getPlayerTrackers(seasonId, playerId),
    getSeasonLineThresholds(seasonId),
  ]);

  const bannedMoves = formatRules?.banned_moves?.length ? formatRules.banned_moves : DEFAULT_BANNED_MOVES;
  const bannedItems = formatRules?.banned_items?.length ? formatRules.banned_items : DEFAULT_BANNED_ITEMS;
  const teraRules: TeraRules = formatRules?.tera_rules ?? DEFAULT_TERA_RULES;
  const stageByIndex = resolveStageByIndex(pokemon, trackers, lines);

  return validateEpbTeam(pokemon, { bannedMoves, bannedItems, teraRules, stageByIndex });
}

/**
 * Throwing wrapper around `validateEpbTeamForSeason` for hard-gate call sites
 * (e.g. match-prep check-in). Throws `UserFacingError` (status 400) when the
 * team violates the season's EPB format rules.
 */
export async function assertEpbTeamCompliant(
  seasonId: string,
  playerId: string,
  pokemon: PokemonSet[],
): Promise<void> {
  const result = await validateEpbTeamForSeason(seasonId, playerId, pokemon);
  if (result.valid) return;

  const messages = [
    ...result.team_issues,
    ...result.issues.map((issue) => `${issue.species}: ${issue.issue}`),
  ];
  throw new UserFacingError(messages.join(' | '), {
    status: 400,
    code: 'epb_team_invalid',
  });
}
