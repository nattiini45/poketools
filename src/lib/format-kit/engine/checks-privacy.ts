/**
 * The privacy check of the compiler: a rule whose result everybody can see must not read a relation that not everybody
 * can see.
 *
 * `rel(key, a, b)` answers whether two players are linked. When the answer decides something public (who is paired in a
 * round, which attribute a player carries, a metric of the standings table, whether a stage ends, who an effect hits),
 * a player can read the link off the outcome, and the relation's `visibility` (a hidden Secret Santa) is gone. The
 * author may well intend that, for instance a pairing that keeps givers away from their recipients, so this is a
 * WARNING (`public_expr_reads_hidden_relation`), never an error: it does not block publishing or attaching.
 *
 * A relation counts as hidden when a side is not visible to everyone (`hidden` or `own`); once `reveal_on` has fired both
 * sides are public, but that is runtime state the compiler does not see, so the warning is given anyway.
 *
 * Expressions that stay private are left out: the filter of an action step (it narrows the picker of the player who
 * acts), an assisted check (admins only) and the condition of a team rule (its verdict goes to the team's owner and to
 * site admins).
 *
 * One diagnostic per expression and relation, at the expression's pointer. Pure: definition in, diagnostics out.
 */
import { toMap } from '@/lib/studio-core/keys';
import type { Expr } from '../expr/ast';
import { childrenOf } from '../expr/ast';
import type { EffectTarget, FormatDefinition, RelationDef } from '../types';
import { diag, ptr, type Diagnostic } from './diagnostics';

/** A relation any viewer may not see whole: one of its sides is `hidden` or `own`. */
export function hasHiddenSide(relation: Pick<RelationDef, 'visibility'>): boolean {
  return relation.visibility.from !== 'all' || relation.visibility.to !== 'all';
}

/**
 * Where the expression sits: `context` is a key of the catalog's expression contexts, `owner` is the key of the thing that
 * holds it (a rule id, a stage key, an attribute key, a metric key or an advancement rule key) and `kind` says which.
 */
interface PublicSite {
  readonly context: string;
  readonly kind: 'rule' | 'stage' | 'attr' | 'metric' | 'edge';
  readonly owner: string;
  readonly pointer: string;
  readonly expr: Expr;
}

/** The relation keys an expression reads with `rel()`, in first-use order. Iterative, so a deep tree cannot overflow the stack. */
export function relationsRead(expr: unknown): string[] {
  const found: string[] = [];
  const stack: unknown[] = [expr];
  let seen = 0;
  // The schema bounds an expression (nodes and depth); this cap only keeps a hand-built tree from running away.
  while (stack.length > 0 && seen < 100_000) {
    const node = stack.pop();
    seen += 1;
    if (typeof node !== 'object' || node === null) continue;
    const record = node as { k?: unknown; relation?: unknown };
    if (record.k === 'rel' && typeof record.relation === 'string' && !found.includes(record.relation)) found.push(record.relation);
    const kids = childrenOf(node);
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return found;
}

function targetSites(sites: PublicSite[], owner: string, target: EffectTarget, pointer: string): void {
  if (target.where !== undefined) {
    sites.push({ context: 'effect_target', kind: 'rule', owner, pointer: `${pointer}/where`, expr: target.where });
  }
}

function publicSites(def: FormatDefinition): PublicSite[] {
  const sites: PublicSite[] = [];

  (def.attributes ?? []).forEach((attr, i) => {
    if (attr.assign?.kind === 'expr') {
      sites.push({ context: 'attr_assign', kind: 'attr', owner: attr.key, pointer: ptr('attributes', i, 'assign', 'expr'), expr: attr.assign.expr });
    }
  });

  (def.metrics ?? []).forEach((metric, i) => {
    if (metric.kind === 'metric.define') {
      sites.push({ context: 'metric', kind: 'metric', owner: metric.key, pointer: ptr('metrics', i, 'expr'), expr: metric.expr });
    } else if (metric.kind === 'track.progression') {
      metric.steps.forEach((step, j) => {
        sites.push({ context: 'track_step', kind: 'metric', owner: metric.key, pointer: ptr('metrics', i, 'steps', j, 'when'), expr: step.when });
      });
    }
  });

  def.stages.forEach((stage, i) => {
    if (stage.pairing.kind === 'filter') {
      sites.push({ context: 'pair_filter', kind: 'stage', owner: stage.key, pointer: ptr('stages', i, 'pairing', 'allow'), expr: stage.pairing.allow });
    }
    if (stage.end_when?.kind === 'expr') {
      sites.push({ context: 'stage_end', kind: 'stage', owner: stage.key, pointer: ptr('stages', i, 'end_when', 'when'), expr: stage.end_when.when });
    }
  });

  def.edges.forEach((edge, i) => {
    edge.select.forEach((select, j) => {
      if (select.kind === 'threshold') {
        sites.push({ context: 'threshold', kind: 'edge', owner: edge.key, pointer: ptr('edges', i, 'select', j, 'when'), expr: select.when });
      }
    });
  });

  def.rules.forEach((rule, i) => {
    if (rule.kind !== 'rule.on_event') return;
    if (rule.when !== undefined) {
      sites.push({ context: 'event_condition', kind: 'rule', owner: rule.id, pointer: ptr('rules', i, 'when'), expr: rule.when });
    }
    rule.effects.forEach((effect, j) => {
      if ('to' in effect) targetSites(sites, rule.id, effect.to, ptr('rules', i, 'effects', j, 'to'));
    });
  });

  return sites;
}

/** A warning for each public expression that reads a relation with a hidden side. */
export function checkPublicRelationReads(def: FormatDefinition): Diagnostic[] {
  // First declaration wins, like every other lookup of the compiler (a duplicate key is its own error).
  const hidden = new Set<string>();
  for (const [key, relation] of toMap(def.relations ?? [], (r) => r.key)) if (hasHiddenSide(relation)) hidden.add(key);
  if (hidden.size === 0) return [];

  const out: Diagnostic[] = [];
  for (const site of publicSites(def)) {
    for (const relation of relationsRead(site.expr)) {
      if (!hidden.has(relation)) continue;
      out.push(
        diag('public_expr_reads_hidden_relation', site.pointer, {
          relation,
          context: site.context,
          owner_kind: site.kind,
          owner: site.owner,
        }),
      );
    }
  }
  return out;
}
