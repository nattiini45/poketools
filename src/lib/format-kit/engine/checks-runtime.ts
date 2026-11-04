/**
 * Checks of the Phase 3 sections: attributes, domains, relations, resources, metrics, tunables and the rule kinds that
 * use them (events and effects, player actions, assisted checks, manual adjustments).
 *
 * Every reference must resolve, every default and entry value must fit its attribute, and every expression must type
 * check in its own environment (`runtime-names.ts`). A reference to a stage reuses `ref_unknown_stage`; every other
 * unresolved reference is `ref_unknown` with the kind of thing that was looked for. Expression problems are
 * `expr_invalid` with the expression's `context` and the original `issue` code. Lookups go through Maps, first wins.
 */
import { toMap } from '@/lib/studio-core/keys';
import { typeCheck, type ExprType, type TypeEnv } from '../expr';
import type { Expr } from '../expr/ast';
import type {
  ActionStep,
  AttributeDef,
  DomainDef,
  Effect,
  EffectTarget,
  EventSpec,
  FormatDefinition,
  PlayerActionRule,
  ResourceDef,
  TunableDef,
} from '../types';
import { diag, ptr, type Diagnostic } from './diagnostics';
import type { CompileEnv } from './env';
import {
  BUILTIN_METRICS,
  assignEnv,
  attrExprType,
  attributeMap,
  entryEnv,
  eventEnv,
  matchEnv,
  playerEnv,
} from './runtime-names';

/** Where an expression sits; the renderer turns it into words. */
type ExprContext = 'attr_assign' | 'metric' | 'track_step' | 'effect_target' | 'event_condition' | 'action_step' | 'check';

interface Lookup {
  readonly def: FormatDefinition;
  readonly env: CompileEnv;
  readonly attrs: ReadonlyMap<string, AttributeDef>;
  readonly domains: ReadonlyMap<string, DomainDef>;
  readonly resources: ReadonlyMap<string, ResourceDef>;
  readonly relations: ReadonlySet<string>;
  readonly actions: ReadonlyMap<string, PlayerActionRule>;
  readonly stages: ReadonlySet<string>;
}

function buildLookup(def: FormatDefinition, env: CompileEnv): Lookup {
  const actions = new Map<string, PlayerActionRule>();
  for (const rule of def.rules) {
    if (rule.kind === 'player.action' && !actions.has(rule.id)) actions.set(rule.id, rule);
  }
  return {
    def,
    env,
    attrs: attributeMap(def),
    domains: toMap(def.domains ?? [], (d) => d.key),
    resources: toMap(def.resources ?? [], (r) => r.key),
    relations: new Set((def.relations ?? []).map((r) => r.key)),
    actions,
    stages: new Set(def.stages.map((s) => s.key)),
  };
}

function duplicates<T>(out: Diagnostic[], scope: string, items: readonly T[] | undefined, keyOf: (item: T) => string): void {
  toMap(items ?? [], keyOf, (item, index) => {
    out.push(diag('key_duplicate', ptr(scope, index, 'key'), { scope, key: keyOf(item) }));
  });
}

function checkExpr(
  out: Diagnostic[],
  expr: Expr,
  env: TypeEnv,
  expected: ExprType,
  pointer: string,
  context: ExprContext,
): void {
  const result = typeCheck(expr, env, expected);
  if (result.ok) return;
  for (const issue of result.issues) {
    out.push(diag('expr_invalid', `${pointer}${issue.pointer}`, { ...issue.params, context, issue: issue.code }));
  }
}

function unknownRef(out: Diagnostic[], pointer: string, kind: string, key: string, where: string): void {
  out.push(diag('ref_unknown', pointer, { ref: kind, key, where }));
}

function checkStageRef(out: Diagnostic[], lookup: Lookup, pointer: string, key: string | undefined, where: string): void {
  if (key !== undefined && !lookup.stages.has(key)) out.push(diag('ref_unknown_stage', pointer, { key, where }));
}

// --- Attributes ---------------------------------------------------------------------------------

function checkAttributes(out: Diagnostic[], lookup: Lookup): void {
  (lookup.def.attributes ?? []).forEach((attr, i) => {
    const at = (...path: (string | number)[]) => ptr('attributes', i, ...path);
    if (attr.type === 'enum' && attr.values === undefined) {
      out.push(diag('attr_values_required', at('type'), { attr: attr.key }));
    }
    if (attr.type !== 'enum' && attr.values !== undefined) {
      out.push(diag('attr_values_unexpected', at('values'), { attr: attr.key, type: attr.type }));
    }
    const seen = new Set<string>();
    (attr.values ?? []).forEach((value, j) => {
      if (seen.has(value)) out.push(diag('attr_value_duplicate', at('values', j), { attr: attr.key, value }));
      seen.add(value);
    });
    if (attr.multi === true && !(attr.on === 'entry' && attr.type === 'enum')) {
      out.push(diag('attr_multi_invalid', at('multi'), { attr: attr.key }));
    }
    const assign = attr.assign;
    if (assign === undefined) return;
    if (attr.on === 'entry') {
      out.push(diag('attr_assign_on_entry', at('assign'), { attr: attr.key }));
      return;
    }
    if (assign.kind === 'random_seeded' && attr.type !== 'enum' && attr.type !== 'bool') {
      out.push(diag('attr_random_type', at('assign', 'kind'), { attr: attr.key, type: attr.type }));
    }
    if (assign.kind === 'expr') {
      checkExpr(out, assign.expr, assignEnv(lookup.def), attrExprType(attr), at('assign', 'expr'), 'attr_assign');
    }
  });
}

// --- Domains ------------------------------------------------------------------------------------

/** Why a value does not fit an attribute, or null. A list belongs to a multi attribute only. */
function valueProblem(attr: AttributeDef, value: unknown): string | null {
  if (Array.isArray(value)) {
    if (attr.multi !== true) return 'list_unexpected';
    const allowed = new Set(attr.values ?? []);
    if (value.some((item) => typeof item !== 'string' || !allowed.has(item))) return 'enum_value';
    return new Set(value).size === value.length ? null : 'list_duplicate';
  }
  if (attr.multi === true) return 'list_required';
  switch (attr.type) {
    case 'enum':
      if (typeof value !== 'string') return 'type';
      return (attr.values ?? []).includes(value) ? null : 'enum_value';
    case 'number':
      return typeof value === 'number' ? null : 'type';
    case 'bool':
      return typeof value === 'boolean' ? null : 'type';
    default:
      return typeof value === 'string' ? null : 'type';
  }
}

function checkDomains(out: Diagnostic[], lookup: Lookup): void {
  const species = lookup.env.speciesIds;
  (lookup.def.domains ?? []).forEach((domain, i) => {
    const ids = new Set<string>();
    domain.entries.forEach((entry, j) => {
      const at = (...path: (string | number)[]) => ptr('domains', i, 'entries', j, ...path);
      if (ids.has(entry.id)) out.push(diag('domain_entry_duplicate', at('id'), { domain: domain.key, id: entry.id }));
      ids.add(entry.id);
      if (species !== undefined && !species.has(entry.id)) {
        out.push(diag('domain_entry_unknown_species', at('id'), { domain: domain.key, id: entry.id }));
      }
      const keys = new Set<string>();
      entry.attrs.forEach((entryAttr, k) => {
        const base = { domain: domain.key, id: entry.id, attr: entryAttr.key };
        if (keys.has(entryAttr.key)) out.push(diag('domain_attr_duplicate', at('attrs', k, 'key'), base));
        keys.add(entryAttr.key);
        const attr = lookup.attrs.get(entryAttr.key);
        if (attr === undefined || attr.on !== 'entry') {
          out.push(diag('domain_attr_unknown', at('attrs', k, 'key'), base));
          return;
        }
        const problem = valueProblem(attr, entryAttr.value);
        if (problem !== null) out.push(diag('domain_attr_value_invalid', at('attrs', k, 'value'), { ...base, reason: problem }));
      });
    });
  });
}

// --- Relations, resources, tunables -------------------------------------------------------------

function checkRelations(out: Diagnostic[], lookup: Lookup): void {
  const roster = lookup.env.rosterSize;
  (lookup.def.relations ?? []).forEach((relation, i) => {
    if (relation.shape === 'derangement' && roster !== undefined && roster < 2) {
      out.push(diag('relation_roster_too_small', ptr('relations', i, 'shape'), { relation: relation.key, roster }));
    }
    if (relation.reveal_on !== undefined) checkEvent(out, lookup, relation.reveal_on, ptr('relations', i, 'reveal_on'));
  });
}

function checkResources(out: Diagnostic[], lookup: Lookup): void {
  (lookup.def.resources ?? []).forEach((resource, i) => {
    if (resource.holds.kind === 'domain' && !lookup.domains.has(resource.holds.domain)) {
      unknownRef(out, ptr('resources', i, 'holds', 'domain'), 'domain', resource.holds.domain, 'resource');
    }
    if (resource.exclusive === 'global' && resource.holds.kind !== 'domain') {
      out.push(diag('resource_exclusive_needs_domain', ptr('resources', i, 'exclusive'), { resource: resource.key }));
    }
  });
}

function tunableDefaultProblem(tunable: TunableDef): string | null {
  const value = tunable.default;
  switch (tunable.type) {
    case 'number':
      if (typeof value !== 'number') return 'type';
      return (tunable.min !== undefined && value < tunable.min) || (tunable.max !== undefined && value > tunable.max)
        ? 'range'
        : null;
    case 'bool':
      return typeof value === 'boolean' ? null : 'type';
    case 'enum':
      if (typeof value !== 'string') return 'type';
      return (tunable.values ?? []).includes(value) ? null : 'enum_value';
    default:
      return Array.isArray(value) ? null : 'type';
  }
}

function checkTunables(out: Diagnostic[], lookup: Lookup): void {
  (lookup.def.tunables ?? []).forEach((tunable, i) => {
    const at = (...path: (string | number)[]) => ptr('tunables', i, ...path);
    if (tunable.type === 'enum' && tunable.values === undefined) {
      out.push(diag('tunable_values_mismatch', at('values'), { tunable: tunable.key, reason: 'required' }));
    }
    if (tunable.type !== 'enum' && tunable.values !== undefined) {
      out.push(diag('tunable_values_mismatch', at('values'), { tunable: tunable.key, reason: 'unexpected' }));
    }
    if ((tunable.min !== undefined || tunable.max !== undefined) && tunable.type !== 'number') {
      out.push(diag('tunable_bounds_invalid', at('type'), { tunable: tunable.key, reason: 'not_number' }));
    } else if (tunable.min !== undefined && tunable.max !== undefined && tunable.min > tunable.max) {
      out.push(diag('tunable_bounds_invalid', at('min'), { tunable: tunable.key, reason: 'min_over_max' }));
    }
    const problem = tunableDefaultProblem(tunable);
    if (problem !== null) out.push(diag('tunable_default_invalid', at('default'), { tunable: tunable.key, reason: problem }));
  });
}

// --- Metrics ------------------------------------------------------------------------------------

function checkMetrics(out: Diagnostic[], lookup: Lookup): void {
  const { def } = lookup;
  (def.metrics ?? []).forEach((metric, i) => {
    const at = (...path: (string | number)[]) => ptr('metrics', i, ...path);
    if (BUILTIN_METRICS.has(metric.key)) out.push(diag('metric_key_builtin', at('key'), { metric: metric.key }));
    switch (metric.kind) {
      case 'metric.define':
        checkExpr(out, metric.expr, metric.of === 'player' ? playerEnv(def) : matchEnv(def), 'number', at('expr'), 'metric');
        break;
      case 'track.progression':
        checkStageRef(out, lookup, at('stage'), metric.stage, 'metric');
        metric.steps.forEach((step, j) => {
          checkExpr(out, step.when, matchEnv(def), 'boolean', at('steps', j, 'when'), 'track_step');
        });
        break;
      case 'score.placement':
        checkStageRef(out, lookup, at('stage'), metric.stage, 'metric');
        break;
    }
  });
}

// --- Events, effects, actions -------------------------------------------------------------------

function checkEvent(out: Diagnostic[], lookup: Lookup, event: EventSpec, pointer: string): void {
  if (event.event === 'action_locked') {
    if (!lookup.actions.has(event.action)) unknownRef(out, `${pointer}/action`, 'action', event.action, 'event');
    return;
  }
  if (event.event !== 'time') checkStageRef(out, lookup, `${pointer}/stage`, event.stage, 'event');
}

function checkTarget(out: Diagnostic[], lookup: Lookup, target: EffectTarget, pointer: string): void {
  if (target.where !== undefined) {
    checkExpr(out, target.where, playerEnv(lookup.def), 'boolean', `${pointer}/where`, 'effect_target');
  }
}

function itemProblem(resource: ResourceDef, domain: DomainDef | undefined, item: string | undefined): string | null {
  if (resource.holds.kind === 'counter') return item === undefined ? null : 'counter';
  if (item === undefined) return 'missing';
  if (domain === undefined) return null;
  return domain.entries.some((entry) => entry.id === item) ? null : 'unknown';
}

function setAttrProblem(attr: AttributeDef | undefined, value: Effect & { effect: 'set_attr' }): string | null {
  if (attr === undefined) return 'unknown';
  if (attr.on !== 'player') return 'entry';
  const fit = valueProblem(attr, value.value);
  return fit === null ? null : fit === 'enum_value' ? 'enum_value' : 'type';
}

function checkEffect(out: Diagnostic[], lookup: Lookup, effect: Effect, pointer: string): void {
  switch (effect.effect) {
    case 'unlock_domain':
    case 'lock_domain':
      if (!lookup.domains.has(effect.domain)) unknownRef(out, `${pointer}/domain`, 'domain', effect.domain, 'effect');
      return;
    case 'reveal_relation':
    case 'generate_relation':
      if (!lookup.relations.has(effect.relation)) unknownRef(out, `${pointer}/relation`, 'relation', effect.relation, 'effect');
      return;
    case 'grant_resource':
    case 'revoke_resource': {
      checkTarget(out, lookup, effect.to, `${pointer}/to`);
      const resource = lookup.resources.get(effect.resource);
      if (resource === undefined) {
        unknownRef(out, `${pointer}/resource`, 'resource', effect.resource, 'effect');
        return;
      }
      const domain = resource.holds.kind === 'domain' ? lookup.domains.get(resource.holds.domain) : undefined;
      const problem = itemProblem(resource, domain, effect.item);
      if (problem !== null) {
        out.push(diag('effect_item_invalid', `${pointer}/item`, { resource: effect.resource, reason: problem }));
      }
      return;
    }
    case 'adjust_points':
      checkStageRef(out, lookup, `${pointer}/stage`, effect.stage, 'effect');
      checkTarget(out, lookup, effect.to, `${pointer}/to`);
      return;
    case 'set_attr': {
      checkTarget(out, lookup, effect.to, `${pointer}/to`);
      const problem = setAttrProblem(lookup.attrs.get(effect.attr), effect);
      if (problem !== null) out.push(diag('effect_set_attr_invalid', `${pointer}/attr`, { attr: effect.attr, reason: problem }));
      return;
    }
    case 'open_action':
    case 'lock_action':
      if (!lookup.actions.has(effect.action)) unknownRef(out, `${pointer}/action`, 'action', effect.action, 'effect');
      return;
    case 'notify':
      checkTarget(out, lookup, effect.to, `${pointer}/to`);
      return;
  }
}

function checkStep(out: Diagnostic[], lookup: Lookup, action: PlayerActionRule, step: ActionStep, pointer: string): void {
  const resource = lookup.resources.get(step.resource);
  if (resource === undefined) {
    unknownRef(out, `${pointer}/resource`, 'resource', step.resource, 'action');
  } else if (resource.holds.kind !== 'domain') {
    out.push(diag('action_step_mismatch', `${pointer}/resource`, { action: action.id, resource: step.resource, reason: 'counter' }));
  } else if (resource.holds.domain !== step.domain) {
    out.push(diag('action_step_mismatch', `${pointer}/domain`, { action: action.id, resource: step.resource, reason: 'other_domain' }));
  }
  if (!lookup.domains.has(step.domain)) unknownRef(out, `${pointer}/domain`, 'domain', step.domain, 'action');
  if (step.where !== undefined) {
    checkExpr(out, step.where, entryEnv(lookup.def), 'boolean', `${pointer}/where`, 'action_step');
  }
  if (step.distinct_attr !== undefined) {
    const attr = lookup.attrs.get(step.distinct_attr);
    const reason = attr === undefined ? 'unknown' : attr.on !== 'entry' ? 'player' : attr.multi === true ? 'multi' : null;
    if (reason !== null) {
      out.push(diag('action_distinct_attr_invalid', `${pointer}/distinct_attr`, { action: action.id, attr: step.distinct_attr, reason }));
    }
  }
}

function checkAction(out: Diagnostic[], lookup: Lookup, action: PlayerActionRule, i: number): void {
  const at = (...path: (string | number)[]) => ptr('rules', i, ...path);
  if (action.via !== undefined && !lookup.relations.has(action.via)) {
    unknownRef(out, at('via'), 'relation', action.via, 'action');
  }
  if (action.window.opens_on !== undefined) checkEvent(out, lookup, action.window.opens_on, at('window', 'opens_on'));
  if (action.window.closes_on !== undefined) checkEvent(out, lookup, action.window.closes_on, at('window', 'closes_on'));
  if (action.lock === 'on_close' && action.window.closes_on === undefined) {
    out.push(diag('action_close_missing', at('lock'), { action: action.id }));
  }
  const picked = new Map<string, number>();
  action.steps.forEach((step, j) => {
    checkStep(out, lookup, action, step, at('steps', j));
    picked.set(step.resource, (picked.get(step.resource) ?? 0) + step.count);
  });
  for (const [key, count] of picked) {
    const capacity = lookup.resources.get(key)?.capacity;
    if (capacity !== undefined && count > capacity) {
      out.push(diag('action_exceeds_capacity', at('steps'), { action: action.id, resource: key, count, capacity }));
    }
  }
}

function checkRules(out: Diagnostic[], lookup: Lookup): void {
  const { def } = lookup;
  def.rules.forEach((rule, i) => {
    const at = (...path: (string | number)[]) => ptr('rules', i, ...path);
    switch (rule.kind) {
      case 'rule.on_event':
        checkEvent(out, lookup, rule.on, at('on'));
        if (rule.when !== undefined) checkExpr(out, rule.when, eventEnv(def), 'boolean', at('when'), 'event_condition');
        rule.effects.forEach((effect, j) => checkEffect(out, lookup, effect, at('effects', j)));
        break;
      case 'player.action':
        checkAction(out, lookup, rule, i);
        break;
      case 'check.assisted': {
        const source = rule.source;
        if (source.kind === 'standings_tie' || source.kind === 'pairing_rematch') {
          checkStageRef(out, lookup, at('source', 'stage'), source.stage, 'check');
        } else if (source.kind === 'expr') {
          checkExpr(out, source.when, source.of === 'player' ? playerEnv(def) : matchEnv(def), 'boolean', at('source', 'when'), 'check');
        }
        break;
      }
      case 'adjust.manual': {
        const seen = new Set<string>();
        rule.allow.forEach((kind, j) => {
          if (seen.has(kind)) out.push(diag('adjust_kind_duplicate', at('allow', j), { rule: rule.id, adjust: kind }));
          seen.add(kind);
        });
        break;
      }
      default:
        break;
    }
  });
}

export function checkRuntime(def: FormatDefinition, env: CompileEnv): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lookup = buildLookup(def, env);
  duplicates(out, 'attributes', def.attributes, (a) => a.key);
  duplicates(out, 'domains', def.domains, (d) => d.key);
  duplicates(out, 'relations', def.relations, (r) => r.key);
  duplicates(out, 'resources', def.resources, (r) => r.key);
  duplicates(out, 'metrics', def.metrics, (m) => m.key);
  duplicates(out, 'tunables', def.tunables, (t) => t.key);
  checkAttributes(out, lookup);
  checkDomains(out, lookup);
  checkRelations(out, lookup);
  checkResources(out, lookup);
  checkMetrics(out, lookup);
  checkTunables(out, lookup);
  checkRules(out, lookup);
  return out;
}
