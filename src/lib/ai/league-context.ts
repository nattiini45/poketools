/**
 * Shared league-context formatters for AI prompts.
 *
 * Both the legacy match-analysis/scouting builders (`context-builder.ts`),
 * the Kale tournament-report builder (`tournament-report-context.ts`), and the
 * agent context pack (`agent/context-pack.ts`) need to describe the same league
 * mechanics — type-quota / tera / evolution constraints, allowlists and per-player
 * Core Liga assignments — to the model. These pure formatters keep that wording in ONE
 * place so the prompts can't drift apart. The text mirrors the actual semantics
 * enforced in `src/lib/pkmn/validation.ts` (`enforceTeamConstraints`).
 */
import type { Ruleset, TeamConstraints } from '@/types/ruleset';
import type { CoreTriple } from '@/types/season';

const ALLOWLIST_LABELS = [
  ['pokemon', 'Pokémon'],
  ['moves', 'moves'],
  ['items', 'items'],
  ['abilities', 'abilities'],
] as const;

/**
 * Render the lists of a ruleset that are ALLOWLISTS (only the listed entries are legal) as one line each; nothing for a list
 * that is not in allowlist mode. A long list is cut at `cap` names with the rest counted. A model that is told only about
 * bans would call an allowlist league's other Pokémon legal, so every prompt that prints bans prints these too.
 */
export function renderAllowlists(allow: Ruleset['allow'], cap = 30): string[] {
  const lines: string[] = [];
  for (const [key, label] of ALLOWLIST_LABELS) {
    const names = allow[key];
    if (names === null) continue;
    const shown = names.slice(0, cap).join(', ');
    const more = names.length > cap ? ` (+${names.length - cap} more)` : '';
    lines.push(`Allowlist: ONLY these ${label} are legal (${names.length}): ${shown || 'none'}${more}`);
  }
  return lines;
}

/**
 * Render a league's `team_constraints` as terse human-readable lines (no
 * leading header — callers place it under their own section). Returns `[]` when
 * there are no constraints, so callers can spread unconditionally.
 */
export function renderTeamConstraints(constraints: TeamConstraints | null | undefined): string[] {
  if (!constraints) return [];
  const lines: string[] = [];

  const quota = constraints.type_quotas;
  if (quota) {
    const counting = quota.allow_multi_count
      ? 'a dual-type Pokémon counts toward each of its types'
      : 'only a Pokémon\'s primary type counts';
    if (quota.source === 'player_core') {
      lines.push(
        `Type quota: at least ${quota.min_per_type} Pokémon of EACH of the player's three assigned core types (${counting}).`,
      );
    } else {
      const types = quota.fixed_types?.length ? quota.fixed_types.join(', ') : 'the specified types';
      lines.push(
        `Type quota: at least ${quota.min_per_type} Pokémon of each of: ${types} (${counting}).`,
      );
    }
  }

  if (constraints.tera_match && constraints.tera_match !== 'none') {
    lines.push(
      constraints.tera_match === 'player_core'
        ? "Tera rule: every Pokémon's Tera type must be one of the player's assigned core types."
        : "Tera rule: every Pokémon's Tera type must match one of that Pokémon's own base types.",
    );
  }

  const evo = constraints.evolution_stage;
  if (evo?.mode === 'nfe_only_plus_n_fe') {
    const cap = evo.fully_evolved_cap ?? 0;
    const tierMax = evo.fully_evolved_tier_max ? `, fully-evolved tier capped at ${evo.fully_evolved_tier_max}` : '';
    const legend = evo.legendaries_allowed ? '' : ', no legendaries';
    lines.push(
      `Evolution rule: mainly not-fully-evolved Pokémon — at most ${cap} fully-evolved allowed${tierMax}${legend}.`,
    );
  } else if (evo?.mode === 'unrestricted' && evo.legendaries_allowed === false) {
    lines.push('Evolution rule: no legendaries allowed.');
  }

  if (constraints.eviolite_tier_cap) {
    lines.push(`Eviolite rule: only Pokémon whose evolution is at or below tier ${constraints.eviolite_tier_cap} may hold Eviolite.`);
  }

  return lines;
}

/** One player's Core Liga assignment for {@link renderCoreAssignments}. */
export interface CoreAssignmentEntry {
  name: string;
  core: CoreTriple | null | undefined;
  /** Mark the requesting player ("you") in scouting/teambuilding contexts. */
  isSelf?: boolean;
}

/**
 * Render per-player assigned core types (the "Core Liga" mechanic — a league
 * assigns each player a fixed set of types to build around). Returns `[]` when
 * no entry has a core, so a gym-leader or constraint-free league emits nothing
 * here. Includes a leading header line when there is at least one core.
 */
export function renderCoreAssignments(entries: CoreAssignmentEntry[]): string[] {
  const withCore = entries.filter((e): e is CoreAssignmentEntry & { core: CoreTriple } =>
    Array.isArray(e.core) && e.core.length === 3,
  );
  if (withCore.length === 0) return [];

  const lines = ['Assigned Core Types (each player must build their team around these types):'];
  for (const e of withCore) {
    const label = e.isSelf ? `${e.name} (you)` : e.name;
    lines.push(`- ${label}: ${e.core.join(' / ')}`);
  }
  return lines;
}
