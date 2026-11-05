/**
 * Checks of the Phase 4 stage fields: the bipartite and filtered pairings, team constraints, the calendar with its
 * deadline policies, `end_when` and `foreach_group`.
 *
 * Every reference must resolve (`ref_unknown` with the kind of thing that was looked for), every expression type
 * checks in its own environment (`runtime-names.ts`: pair, team and stage env) and the combinations the schema cannot
 * rule out are diagnostics with a `reason`. Lookups go through Maps, first wins. Calendar text (a date and a time of
 * day) is shape-checked here rather than in the schema, so a stored document with a bad date stays loadable.
 */
import { toMap } from '@/lib/studio-core/keys';
import { TYPES } from '@/lib/pkmn/type-chart';
import type {
  AttributeDef,
  CountSource,
  DeadlinePolicy,
  DomainDef,
  FormatDefinition,
  PlayerActionRule,
  ResourceDef,
  Stage,
  StageCalendar,
  TeamConstraint,
} from '../types';
import { checkExpr } from './checks-runtime';
import { diag, ptr, type Diagnostic } from './diagnostics';
import type { CompileEnv } from './env';
import { attributeMap, pairEnv, stageEnv, teamEnv } from './runtime-names';

const TYPE_NAMES: ReadonlySet<string> = new Set(TYPES.map((name) => name.toLowerCase()));
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

interface Lookup {
  readonly def: FormatDefinition;
  readonly env: CompileEnv;
  readonly attrs: ReadonlyMap<string, AttributeDef>;
  readonly domains: ReadonlyMap<string, DomainDef>;
  readonly resources: ReadonlyMap<string, ResourceDef>;
  readonly actions: ReadonlyMap<string, PlayerActionRule>;
  /** Index of the first stage with each key. */
  readonly stageIndex: ReadonlyMap<string, number>;
}

function buildLookup(def: FormatDefinition, env: CompileEnv): Lookup {
  const actions = new Map<string, PlayerActionRule>();
  for (const rule of def.rules) {
    if (rule.kind === 'player.action' && !actions.has(rule.id)) actions.set(rule.id, rule);
  }
  const stageIndex = new Map<string, number>();
  def.stages.forEach((stage, i) => {
    if (!stageIndex.has(stage.key)) stageIndex.set(stage.key, i);
  });
  return {
    def,
    env,
    attrs: attributeMap(def),
    domains: toMap(def.domains ?? [], (d) => d.key),
    resources: toMap(def.resources ?? [], (r) => r.key),
    actions,
    stageIndex,
  };
}

/** Why a player attribute cannot be used as an enum, or null. */
function playerEnumProblem(attr: AttributeDef | undefined): string | null {
  if (attr === undefined) return 'unknown';
  if (attr.on !== 'player') return 'entry';
  if (attr.multi === true) return 'multi';
  return attr.type === 'enum' ? null : 'not_enum';
}

// --- Pairings -----------------------------------------------------------------------------------

function checkBipartite(out: Diagnostic[], lookup: Lookup, stage: Stage, i: number): void {
  const pairing = stage.pairing;
  if (pairing.kind !== 'bipartite') return;
  const attr = lookup.attrs.get(pairing.attr);
  const problem = playerEnumProblem(attr);
  const at = (...path: (string | number)[]) => ptr('stages', i, 'pairing', ...path);
  if (problem !== null) {
    out.push(diag('bipartite_attr_invalid', at('attr'), { stage: stage.key, attr: pairing.attr, reason: problem }));
    return;
  }
  const allowed = new Set(attr?.values ?? []);
  const sides = [
    ['a', 'side_a', pairing.side_a],
    ['b', 'side_b', pairing.side_b],
  ] as const;
  for (const [side, field, values] of sides) {
    const seen = new Set<string>();
    values.forEach((value, j) => {
      const base = { stage: stage.key, attr: pairing.attr, value, side };
      if (!allowed.has(value)) out.push(diag('bipartite_value_invalid', at(field, j), { ...base, reason: 'unknown_value' }));
      else if (seen.has(value)) out.push(diag('bipartite_value_invalid', at(field, j), { ...base, reason: 'duplicate' }));
      seen.add(value);
    });
  }
  const sideA = new Set(pairing.side_a);
  pairing.side_b.forEach((value, j) => {
    if (sideA.has(value)) out.push(diag('bipartite_sides_overlap', at('side_b', j), { stage: stage.key, attr: pairing.attr, value }));
  });
}

function checkFilter(out: Diagnostic[], lookup: Lookup, stage: Stage, i: number): void {
  if (stage.pairing.kind !== 'filter') return;
  checkExpr(out, stage.pairing.allow, pairEnv(lookup.def), 'boolean', ptr('stages', i, 'pairing', 'allow'), 'pair_filter');
}

// --- Team constraints ---------------------------------------------------------------------------

function checkCountSource(out: Diagnostic[], lookup: Lookup, stage: Stage, source: CountSource, pointer: string): void {
  switch (source.kind) {
    case 'domain':
      if (!lookup.domains.has(source.domain)) {
        out.push(diag('ref_unknown', `${pointer}/domain`, { ref: 'domain', key: source.domain, where: 'constraint' }));
      }
      return;
    case 'resource': {
      const resource = lookup.resources.get(source.resource);
      if (resource === undefined) {
        out.push(diag('ref_unknown', `${pointer}/resource`, { ref: 'resource', key: source.resource, where: 'constraint' }));
      } else if (resource.holds.kind !== 'domain') {
        out.push(
          diag('constraint_source_invalid', `${pointer}/resource`, {
            stage: stage.key,
            resource: source.resource,
            reason: 'counter',
          }),
        );
      }
      return;
    }
    case 'species': {
      const species = lookup.env.speciesIds;
      if (species === undefined) return;
      source.ids.forEach((id, j) => {
        if (!species.has(id)) out.push(diag('constraint_species_unknown', `${pointer}/ids/${j}`, { stage: stage.key, id }));
      });
      return;
    }
    case 'any_of':
      source.sources.forEach((inner, j) => checkCountSource(out, lookup, stage, inner, `${pointer}/sources/${j}`));
      return;
    case 'not':
      checkCountSource(out, lookup, stage, source.source, `${pointer}/source`);
      return;
  }
}

function checkBounds(
  out: Diagnostic[],
  stage: Stage,
  constraint: TeamConstraint,
  pointer: string,
  low: number | undefined,
  high: number | undefined,
  unbounded: boolean,
): void {
  const base = { stage: stage.key, constraint: constraint.kind };
  if (unbounded) out.push(diag('constraint_bounds_invalid', pointer, { ...base, reason: 'no_bound' }));
  else if (low !== undefined && high !== undefined && low > high) {
    out.push(diag('constraint_bounds_invalid', pointer, { ...base, reason: 'min_over_max' }));
  }
}

function attrProblem(out: Diagnostic[], stage: Stage, constraint: TeamConstraint, pointer: string, attr: string, reason: string | null): void {
  if (reason !== null) out.push(diag('constraint_attr_invalid', pointer, { stage: stage.key, constraint: constraint.kind, attr, reason }));
}

/** An attribute that is required but missing, or present where the constraint takes none. */
function attrUsage(out: Diagnostic[], stage: Stage, constraint: TeamConstraint, pointer: string, reason: 'attr_required' | 'attr_unexpected'): void {
  out.push(diag('constraint_attr_usage', pointer, { stage: stage.key, constraint: constraint.kind, reason }));
}

function checkConstraint(out: Diagnostic[], lookup: Lookup, stage: Stage, constraint: TeamConstraint, pointer: string): void {
  const at = (...path: string[]) => [pointer, ...path].join('/');
  const named = { stage: stage.key, constraint: constraint.kind };
  if (constraint.when !== undefined) {
    checkExpr(out, constraint.when, teamEnv(lookup.def), 'boolean', at('when'), 'team_constraint');
  }
  switch (constraint.kind) {
    case 'roster_size':
      checkBounds(out, stage, constraint, at('min'), constraint.min, constraint.max, false);
      return;
    case 'count':
      checkBounds(out, stage, constraint, at('min'), constraint.min, constraint.max, constraint.min === undefined && constraint.max === undefined);
      checkCountSource(out, lookup, stage, constraint.source, at('source'));
      return;
    case 'distinct': {
      if (constraint.by !== 'attr') {
        if (constraint.attr !== undefined) attrUsage(out, stage, constraint, at('attr'), 'attr_unexpected');
        return;
      }
      if (constraint.attr === undefined) {
        attrUsage(out, stage, constraint, at('by'), 'attr_required');
        return;
      }
      const attr = lookup.attrs.get(constraint.attr);
      const reason = attr === undefined ? 'unknown' : attr.on !== 'entry' ? 'player' : attr.multi === true ? 'multi' : null;
      attrProblem(out, stage, constraint, at('attr'), constraint.attr, reason);
      return;
    }
    case 'type_quota': {
      if (constraint.types.source === 'player_attr') {
        attrProblem(out, stage, constraint, at('types', 'attr'), constraint.types.attr, playerEnumProblem(lookup.attrs.get(constraint.types.attr)));
        return;
      }
      const seen = new Set<string>();
      constraint.types.types.forEach((name, j) => {
        const id = name.toLowerCase();
        if (!TYPE_NAMES.has(id)) out.push(diag('constraint_type_invalid', at('types', 'types', String(j)), { ...named, type: name, reason: 'unknown_type' }));
        else if (seen.has(id)) out.push(diag('constraint_type_invalid', at('types', 'types', String(j)), { ...named, type: name, reason: 'duplicate' }));
        seen.add(id);
      });
      return;
    }
    case 'tera': {
      if (constraint.mode !== 'from_attr') {
        if (constraint.attr !== undefined) attrUsage(out, stage, constraint, at('attr'), 'attr_unexpected');
        return;
      }
      if (constraint.attr === undefined) {
        attrUsage(out, stage, constraint, at('mode'), 'attr_required');
        return;
      }
      attrProblem(out, stage, constraint, at('attr'), constraint.attr, playerEnumProblem(lookup.attrs.get(constraint.attr)));
      return;
    }
    case 'evolution_stage':
      checkBounds(
        out,
        stage,
        constraint,
        at('fully_evolved_max'),
        undefined,
        undefined,
        constraint.fully_evolved_max === undefined && constraint.nfe_max === undefined && constraint.lc_max === undefined,
      );
      return;
  }
}

// --- Calendar -----------------------------------------------------------------------------------

function isRealDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return day <= days;
}

function deadlineReason(policy: DeadlinePolicy): string | null {
  if (policy.applies === 'action' && policy.action === undefined) return 'action_required';
  if (policy.applies !== 'action' && policy.action !== undefined) return 'action_unexpected';
  if (policy.on_miss === 'forfeit' && policy.applies === 'action') return 'forfeit_scope';
  if ((policy.on_miss === 'auto_lock' || policy.on_miss === 'seeded_random_pick') && policy.applies !== 'action') return 'action_only';
  return null;
}

function checkCalendar(out: Diagnostic[], lookup: Lookup, stage: Stage, calendar: StageCalendar, i: number): void {
  const at = (...path: (string | number)[]) => ptr('stages', i, 'calendar', ...path);
  if (calendar.start.kind === 'date' && !isRealDate(calendar.start.date)) {
    out.push(diag('calendar_invalid', at('start', 'date'), { stage: stage.key, reason: 'date' }));
  }
  if (!TIME_PATTERN.test(calendar.time)) out.push(diag('calendar_invalid', at('time'), { stage: stage.key, reason: 'time' }));

  const keys = new Set<string>();
  calendar.marks.forEach((mark, j) => {
    if (keys.has(mark.key)) out.push(diag('key_duplicate', at('marks', j, 'key'), { scope: 'marks', key: mark.key }));
    keys.add(mark.key);
  });
  calendar.deadlines.forEach((policy, j) => {
    const reason = deadlineReason(policy);
    if (reason !== null) {
      out.push(diag('deadline_policy_invalid', at('deadlines', j), { stage: stage.key, applies: policy.applies, on_miss: policy.on_miss, reason }));
    }
    if (policy.action !== undefined && !lookup.actions.has(policy.action)) {
      out.push(diag('ref_unknown', at('deadlines', j, 'action'), { ref: 'action', key: policy.action, where: 'deadline' }));
    }
  });
}

// --- Stage fields -------------------------------------------------------------------------------

function checkForeachGroup(out: Diagnostic[], lookup: Lookup, stage: Stage, i: number): void {
  const foreach = stage.foreach_group;
  if (foreach === undefined) return;
  const at = (...path: (string | number)[]) => ptr('stages', i, ...path);
  const params = { stage: stage.key, from_stage: foreach.from };
  if (stage.groups !== undefined) out.push(diag('foreach_group_invalid', at('groups'), { ...params, reason: 'own_groups' }));
  const index = lookup.stageIndex.get(foreach.from);
  if (index === undefined) {
    out.push(diag('ref_unknown_stage', at('foreach_group', 'from'), { key: foreach.from, where: 'foreach_group' }));
  } else if (index >= i) {
    out.push(diag('foreach_group_invalid', at('foreach_group', 'from'), { ...params, reason: 'not_earlier' }));
  } else if (lookup.def.stages[index].groups === undefined) {
    out.push(diag('foreach_group_invalid', at('foreach_group', 'from'), { ...params, reason: 'no_groups' }));
  }
}

export function checkPhase4(def: FormatDefinition, env: CompileEnv): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lookup = buildLookup(def, env);
  def.stages.forEach((stage, i) => {
    checkBipartite(out, lookup, stage, i);
    checkFilter(out, lookup, stage, i);
    (stage.constraints ?? []).forEach((constraint, j) => {
      checkConstraint(out, lookup, stage, constraint, ptr('stages', i, 'constraints', j));
    });
    if (stage.calendar !== undefined) checkCalendar(out, lookup, stage, stage.calendar, i);
    if (stage.end_when?.kind === 'expr') {
      checkExpr(out, stage.end_when.when, stageEnv(def), 'boolean', ptr('stages', i, 'end_when', 'when'), 'stage_end');
    }
    checkForeachGroup(out, lookup, stage, i);
  });
  return out;
}
