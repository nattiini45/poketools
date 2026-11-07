/**
 * The team constraints of a kit stage (`Stage.constraints`) evaluated against one team: pure, client-safe, no dex. The
 * caller resolves the team into `TeamMember`s (species ids, types, item, tera type, evolution class: `team-server.ts`)
 * and supplies the runtime state; the result is a list of issues with the index of the constraint and of the Pokémon
 * involved. `when` is evaluated in the TEAM env (`teamContext`); a constraint whose `when` is false does not apply, one
 * whose `when` cannot be evaluated reports `kit_constraint_expr` and is skipped.
 *
 * Species matching: a source lists dex ids. A team member matches an id when the id is its own species id, or the id of
 * its BASE species, so an entry `deerling` also covers `deerlingwinter` and `rotom` covers `rotomwash`, while an entry
 * `deerlingwinter` covers only that forme (the base forme `deerling` does not match it).
 *
 * Count sources: `domain` is the entry ids after the admin's amendments (with `unlocked_only` a locked domain matches
 * nothing; a pool the players may not see, an `admins` pool or a still locked `when_unlocked` one, matches nothing
 * either way, so a verdict never reveals its members: the compiler rejects such a source too), `resource` the player's OWN item ids of that resource, `species` the listed ids, `any_of` a union and `not`
 * the complement over the team.
 *
 * Type quota: a Pokémon counts for its primary type only, or for both when `allow_multi_count` (the same reading as the
 * ruleset's `type_quotas`). A `player_attr` quota (and `tera: from_attr`) reads the player's enum attribute as a type
 * name, compared case-insensitively; a value that is no type name matches nothing.
 *
 * Evolution stage: the classes are disjoint (`lc` is a first stage and does not count as `nfe`).
 */
import type { ValidationIssueCode, ValidationIssueParams, SetIssue, TeamIssue, TeamValidationResult } from '@/types/team';
import { evaluate } from '@/lib/format-kit/expr/eval';
import { attributeMap } from '@/lib/format-kit/engine/runtime-names';
import type { CountSource, DomainEntry, FormatDefinition, TeamConstraint } from '@/lib/format-kit/types';
import { domainView, findDomainView, visibleEntries } from './domains';
import { teamContext, playerAttrValue, type EnvBase } from './expr-env';
import type { KitRuntimeState } from './types';

export type EvolutionClass = 'fe' | 'nfe' | 'lc';

/** One Pokémon of the team, resolved by the caller. Ids are `toID` forms; names are the English @pkmn names. */
export interface TeamMember {
  name: string;
  species: string;
  baseName: string;
  baseSpecies: string;
  /** English type names. */
  types: readonly string[];
  /** Item id, '' for none. */
  item: string;
  itemName: string;
  /** English type name of the chosen Tera type, or null. */
  teraType: string | null;
  evolution: EvolutionClass;
}

export type ConstraintIssueCode = Extract<
  ValidationIssueCode,
  | 'kit_roster_size'
  | 'kit_count_min'
  | 'kit_count_max'
  | 'kit_not_allowed'
  | 'kit_distinct'
  | 'kit_type_quota'
  | 'kit_tera_banned'
  | 'kit_tera_stab'
  | 'kit_tera_attr'
  | 'kit_evolution_stage'
  | 'kit_constraint_expr'
>;

export interface ConstraintIssue {
  code: ConstraintIssueCode;
  /** Index into the stage's `constraints`. */
  constraint_index: number;
  /** Team slots (0-based) that the issue is about, when it is about particular Pokémon. */
  pokemon_indexes?: number[];
  params: ValidationIssueParams;
}

export interface ConstraintInput {
  constraints: readonly TeamConstraint[];
  def: FormatDefinition;
  /** Flags (domain locks), the player's own resource items, attributes, tunables and domain amendments. */
  state: KitRuntimeState;
  /** The season seed: a `random_seeded` player attribute is drawn from it. */
  seed: string;
  playerId: string;
  round: number;
  members: readonly TeamMember[];
}

const toId = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

type Matcher = (member: TeamMember) => boolean;

const idMatcher = (ids: ReadonlySet<string>): Matcher => (member) => ids.has(member.species) || ids.has(member.baseSpecies);

function sourceMatcher(source: CountSource, input: ConstraintInput): Matcher {
  switch (source.kind) {
    case 'domain': {
      const view = findDomainView(input.def, source.domain, input.state.flags, input.state.amendments);
      if (view === null || (source.unlocked_only && !view.unlocked)) return () => false;
      // The team verdict is shown to players: read only what a player may see (an `admins` or a locked `when_unlocked` pool is empty).
      return idMatcher(new Set(visibleEntries(view, false).map((entry) => entry.id)));
    }
    case 'resource': {
      const ids = new Set<string>();
      for (const item of input.state.items) {
        if (item.resource === source.resource && item.player_id === input.playerId && item.item_id !== null) ids.add(item.item_id);
      }
      return idMatcher(ids);
    }
    case 'species':
      return idMatcher(new Set(source.ids));
    case 'any_of': {
      const parts = source.sources.map((inner) => sourceMatcher(inner, input));
      return (member) => parts.some((part) => part(member));
    }
    case 'not': {
      const inner = sourceMatcher(source.source, input);
      return (member) => !inner(member);
    }
  }
}

function sourceLabel(source: CountSource): string {
  switch (source.kind) {
    case 'domain':
      return source.unlocked_only ? `domain ${source.domain} (when unlocked)` : `domain ${source.domain}`;
    case 'resource':
      // The player's own holdings of a resource, read as a phrase (`junk_gifts` -> "your own junk gifts").
      return `your own ${source.resource.replace(/_/g, ' ')}`;
    case 'species':
      return `species ${source.ids.join(', ')}`;
    case 'any_of':
      return `any of (${source.sources.map(sourceLabel).join('; ')})`;
    case 'not':
      return `not (${sourceLabel(source.source)})`;
  }
}

function indexesWhere(members: readonly TeamMember[], test: (member: TeamMember) => boolean): number[] {
  const out: number[] = [];
  members.forEach((member, i) => {
    if (test(member)) out.push(i);
  });
  return out;
}

/** The entry of any domain that stands for a member (its own species id first, then its base species id). */
function entryOf(entries: readonly DomainEntry[], member: TeamMember): DomainEntry | undefined {
  return entries.find((entry) => entry.id === member.species) ?? entries.find((entry) => entry.id === member.baseSpecies);
}

function distinctGroups(
  constraint: Extract<TeamConstraint, { kind: 'distinct' }>,
  input: ConstraintInput,
): { by: string; groups: Map<string, { value: string; indexes: number[] }> } {
  const groups = new Map<string, { value: string; indexes: number[] }>();
  const add = (key: string, value: string, index: number) => {
    const group = groups.get(key) ?? { value, indexes: [] };
    group.indexes.push(index);
    groups.set(key, group);
  };
  const { members } = input;
  switch (constraint.by) {
    case 'base_species':
      members.forEach((m, i) => add(m.baseSpecies, m.baseName, i));
      return { by: 'base species', groups };
    case 'species':
      members.forEach((m, i) => add(m.species, m.name, i));
      return { by: 'species', groups };
    case 'item':
      members.forEach((m, i) => {
        if (m.item !== '') add(m.item, m.itemName, i);
      });
      return { by: 'item', groups };
    case 'type':
      members.forEach((m, i) => {
        for (const type of new Set(m.types.map(toId))) add(type, m.types.find((t) => toId(t) === type) ?? type, i);
      });
      return { by: 'type', groups };
    case 'attr': {
      const key = constraint.attr ?? '';
      // Only the entries a player may see: a hidden pool's attribute values would otherwise form groups (and so a verdict).
      const entries = domainView(input.def, input.state.flags, input.state.amendments).flatMap((view) => visibleEntries(view, false));
      members.forEach((m, i) => {
        const value = entryOf(entries, m)?.attrs.find((a) => a.key === key)?.value;
        if (value !== undefined && !Array.isArray(value)) add(String(value), String(value), i);
      });
      return { by: `attribute ${key}`, groups };
    }
  }
}

function evolutionCaps(constraint: Extract<TeamConstraint, { kind: 'evolution_stage' }>): [EvolutionClass, number | undefined][] {
  return [
    ['fe', constraint.fully_evolved_max],
    ['nfe', constraint.nfe_max],
    ['lc', constraint.lc_max],
  ];
}

/** An allowlist: a count of the complement of some pools with a ceiling of zero and no floor. */
function isAllowlist(constraint: Extract<TeamConstraint, { kind: 'count' }>): boolean {
  return constraint.source.kind === 'not' && constraint.max === 0 && constraint.min === undefined;
}

function evaluateOne(constraint: TeamConstraint, index: number, input: ConstraintInput): ConstraintIssue[] {
  const { members } = input;
  const out: ConstraintIssue[] = [];
  const issue = (code: ConstraintIssueCode, params: ValidationIssueParams, pokemon?: number[]) =>
    out.push({ code, constraint_index: index, ...(pokemon !== undefined ? { pokemon_indexes: pokemon } : {}), params });

  switch (constraint.kind) {
    case 'roster_size':
      if (members.length < constraint.min || members.length > constraint.max) {
        issue('kit_roster_size', { min: constraint.min, max: constraint.max, have: members.length });
      }
      return out;
    case 'count': {
      const matches = indexesWhere(members, sourceMatcher(constraint.source, input));
      if (isAllowlist(constraint)) {
        // `not(...)` with a ceiling of zero is an allowlist: name each Pokémon that is outside it instead of a count.
        for (const slot of matches) issue('kit_not_allowed', { species: members[slot]?.name ?? '' }, [slot]);
        return out;
      }
      const source = sourceLabel(constraint.source);
      if (constraint.min !== undefined && matches.length < constraint.min) {
        issue('kit_count_min', { source, min: constraint.min, have: matches.length });
      }
      if (constraint.max !== undefined && matches.length > constraint.max) {
        issue('kit_count_max', { source, max: constraint.max, have: matches.length }, matches);
      }
      return out;
    }
    case 'distinct': {
      const { by, groups } = distinctGroups(constraint, input);
      for (const group of groups.values()) {
        if (group.indexes.length > constraint.max_per) {
          issue('kit_distinct', { by, value: group.value, max: constraint.max_per, have: group.indexes.length }, group.indexes);
        }
      }
      return out;
    }
    case 'type_quota': {
      if (constraint.min_per_type === 0) return out;
      let types: string[];
      if (constraint.types.source === 'fixed') types = constraint.types.types;
      else {
        const attr = attributeMap(input.def).get(constraint.types.attr);
        const value = attr === undefined ? '' : playerAttrValue(envBase(input), input.playerId, attr);
        types = typeof value === 'string' && value !== '' ? [value] : [];
      }
      for (const type of types) {
        const wanted = toId(type);
        const have = members.filter((m) => (constraint.allow_multi_count ? m.types.some((t) => toId(t) === wanted) : m.types[0] !== undefined && toId(m.types[0]) === wanted)).length;
        if (have < constraint.min_per_type) issue('kit_type_quota', { type, min: constraint.min_per_type, have });
      }
      return out;
    }
    case 'tera': {
      if (constraint.mode === 'any') return out;
      let expected = '';
      if (constraint.mode === 'from_attr') {
        const attr = constraint.attr === undefined ? undefined : attributeMap(input.def).get(constraint.attr);
        const value = attr === undefined ? '' : playerAttrValue(envBase(input), input.playerId, attr);
        expected = typeof value === 'string' ? value : '';
      }
      members.forEach((member, i) => {
        if (member.teraType === null || member.teraType === '') return;
        if (constraint.mode === 'banned') issue('kit_tera_banned', {}, [i]);
        else if (constraint.mode === 'stab') {
          if (!member.types.some((t) => toId(t) === toId(member.teraType ?? ''))) {
            issue('kit_tera_stab', { type: member.teraType, species: member.name, types: member.types.join('/') }, [i]);
          }
        } else if (toId(member.teraType) !== toId(expected) || expected === '') {
          issue('kit_tera_attr', { type: member.teraType, types: expected }, [i]);
        }
      });
      return out;
    }
    case 'evolution_stage':
      for (const [stage, max] of evolutionCaps(constraint)) {
        if (max === undefined) continue;
        const matches = indexesWhere(members, (m) => m.evolution === stage);
        if (matches.length > max) issue('kit_evolution_stage', { stage, max, have: matches.length }, matches);
      }
      return out;
  }
}

const envBase = (input: ConstraintInput): EnvBase => ({ def: input.def, state: input.state, seed: input.seed, scope: `team:${input.playerId}` });

/** Whether a constraint applies this round: no `when` = always; an expression that fails reports `kit_constraint_expr`. */
function applies(constraint: TeamConstraint, index: number, input: ConstraintInput, out: ConstraintIssue[]): boolean {
  if (constraint.when === undefined) return true;
  const result = evaluate(constraint.when, teamContext(envBase(input), input.playerId, input.round), 'boolean');
  if (result.ok) return result.value === true;
  out.push({ code: 'kit_constraint_expr', constraint_index: index, params: { index: index + 1, reason: result.issue.code } });
  return false;
}

/** Every violated constraint of the stage for this team, in constraint order. */
export function evaluateConstraints(input: ConstraintInput): ConstraintIssue[] {
  const out: ConstraintIssue[] = [];
  input.constraints.forEach((constraint, index) => {
    if (applies(constraint, index, input, out)) out.push(...evaluateOne(constraint, index, input));
  });
  return out;
}

// --- English text and the team verdict ------------------------------------------------------------

/** The English text of each code: the same sentences as `teambuilder.validation.issue.kit_*` (a test holds them equal). */
const ENGLISH: Record<ConstraintIssueCode, string> = {
  kit_roster_size: 'Team size: this league needs {min} to {max} Pokémon, found {have}',
  kit_count_min: 'Team rule: at least {min} Pokémon from {source} needed, found {have}',
  kit_count_max: 'Team rule: at most {max} Pokémon from {source} allowed, found {have}',
  kit_not_allowed: '{species} is not in any pool you may use in this league',
  kit_distinct: 'Team rule: at most {max} Pokémon may share the same {by} ({value}), found {have}',
  kit_type_quota: 'Type quota: need at least {min} {type}-type Pokémon, have {have}',
  kit_tera_banned: 'Terastallization is not allowed in this league',
  kit_tera_stab: "Tera type {type} must be one of {species}'s types ({types})",
  kit_tera_attr: 'Tera type {type} must be your assigned type ({types})',
  kit_evolution_stage:
    'Evolution stage rule: at most {max} Pokémon of stage {stage} (fe: fully evolved, nfe: not fully evolved, lc: first stage) allowed, found {have}',
  kit_constraint_expr: 'League rule {index} could not be checked ({reason})',
};

export function constraintIssueText(code: ConstraintIssueCode, params: ValidationIssueParams): string {
  return ENGLISH[code].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}

const PER_SET: ReadonlySet<ConstraintIssueCode> = new Set(['kit_tera_banned', 'kit_tera_stab', 'kit_tera_attr', 'kit_not_allowed']);

/**
 * Adds constraint issues to a team verdict: the Tera ones and the allowlist one (`kit_not_allowed`) become errors of
 * their set (the slot of the Pokémon), every other one a team-wide
 * issue (its Pokémon slots stay in the server-side `ConstraintIssue`; the text names the shared value instead).
 */
export function mergeConstraintIssues(
  base: TeamValidationResult,
  issues: readonly ConstraintIssue[],
  members: readonly TeamMember[],
): TeamValidationResult {
  if (issues.length === 0) return base;
  const setIssues: SetIssue[] = [];
  const teamIssues: TeamIssue[] = [];
  for (const item of issues) {
    const text = constraintIssueText(item.code, item.params);
    const slot = item.pokemon_indexes?.[0];
    if (PER_SET.has(item.code) && slot !== undefined) {
      setIssues.push({ pokemon_index: slot, species: members[slot]?.name ?? '', issue: text, severity: 'error', code: item.code, params: item.params });
    } else {
      teamIssues.push({ issue: text, code: item.code, params: item.params });
    }
  }
  const existing = base.team_issue_details && base.team_issue_details.length === base.team_issues.length
    ? base.team_issue_details
    : base.team_issues.map((issue) => ({ issue }));
  const merged = [...existing, ...teamIssues];
  return {
    ...base,
    valid: false,
    issues: [...base.issues, ...setIssues],
    team_issues: merged.map((i) => i.issue),
    team_issue_details: merged,
  };
}
