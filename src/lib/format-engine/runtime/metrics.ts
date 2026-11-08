/**
 * The custom metrics of one stage as standings input (`KitStageMetrics`): the `metric.define` expressions of players,
 * the `score.placement` point tables of the stage, and the attribute, tunable and track values the expressions read.
 * Nothing here is secret (no seed, no relation), so the result may travel with `KitStandingsData`. Pure.
 */
import { childrenOf, type Expr, type ExprValue } from '@/lib/format-kit/expr/ast';
import { seededRand } from '@/lib/format-kit/expr/rand';
import type { FormatDefinition } from '@/lib/format-kit/types';
import type { KitStageMetrics } from '../context';
import { playerExtraRefMap } from './expr-env';
import { publicLinkPairs } from './relations';
import type { KitRuntimeState } from './types';

/** What the expressions read: the relation keys of their `rel()` calls and the names of their refs. */
function usedBy(exprs: readonly Expr[]): { relations: Set<string>; refs: Set<string> } {
  const relations = new Set<string>();
  const refs = new Set<string>();
  const stack: unknown[] = [...exprs];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    const { k, relation, name } = node as { k?: unknown; relation?: unknown; name?: unknown };
    if (k === 'rel' && typeof relation === 'string') relations.add(relation);
    if (k === 'ref' && typeof name === 'string') refs.add(name);
    stack.push(...childrenOf(node));
  }
  return { relations, refs };
}

/** The ref a `rand` draw of a metric becomes (see `withoutRand`); the namespace is a real one, so the evaluator reads it as a plain ref. */
const drawRef = (key: string): string => `track.~rand.${key}`;

/**
 * `expr` with every `seeded_rand(key)` replaced by a number ref (`drawRef`), and the keys it replaced. A metric that draws
 * would otherwise be evaluated with the season seed on the server and without it in the public table (which never holds the
 * seed), and the two tables would rank by different draws. With the draw a per-player value (`stageMetricsFor` fills it from
 * the seed), the public table and the server rank by the same numbers and the seed stays on the server.
 */
function withoutRand(expr: Expr, keys: Set<string>): Expr {
  if (typeof expr !== 'object' || expr === null) return expr;
  if (expr.k === 'rand') {
    keys.add(expr.key);
    return { k: 'ref', name: drawRef(expr.key), t: 'number' };
  }
  const copy: Record<string, unknown> = { ...expr };
  for (const [field, value] of Object.entries(copy)) {
    if (Array.isArray(value)) copy[field] = value.map((item) => (typeof item === 'object' && item !== null && 'k' in item ? withoutRand(item as Expr, keys) : item));
    else if (typeof value === 'object' && value !== null && 'k' in value) copy[field] = withoutRand(value as Expr, keys);
  }
  return copy as unknown as Expr;
}

/** Whether any metric of the format applies to `stageKey` (a player metric applies to every stage). */
export function stageHasCustomMetrics(def: Pick<FormatDefinition, 'metrics'>, stageKey: string): boolean {
  return (def.metrics ?? []).some(
    (metric) => (metric.kind === 'metric.define' && metric.of === 'player') || (metric.kind === 'score.placement' && metric.stage === stageKey),
  );
}

export function stageMetricsFor(
  def: FormatDefinition,
  state: KitRuntimeState,
  seed: string,
  stageKey: string,
  playerIds: readonly string[],
): KitStageMetrics | undefined {
  const defs: KitStageMetrics['defs'] = [];
  const placements: KitStageMetrics['placements'] = [];
  const keys = new Set<string>();
  const drawKeys = new Set<string>();
  for (const metric of def.metrics ?? []) {
    if (keys.has(metric.key)) continue;
    if (metric.kind === 'metric.define' && metric.of === 'player') defs.push({ key: metric.key, expr: withoutRand(metric.expr, drawKeys) });
    else if (metric.kind === 'score.placement' && metric.stage === stageKey) placements.push({ key: metric.key, points: [...metric.points] });
    else continue;
    keys.add(metric.key);
  }
  if (defs.length === 0 && placements.length === 0) return undefined;

  // Only the refs the metric expressions read travel with the table (it is public): an attribute no metric reads, a
  // `random_seeded` one included, never reaches the page.
  const used = usedBy(defs.map((d) => d.expr));
  const playerRefs: Record<string, Record<string, ExprValue>> = {};
  if (defs.length > 0) {
    for (const playerId of new Set(playerIds)) {
      const refs: Record<string, ExprValue> = {};
      for (const [name, value] of playerExtraRefMap({ def, state, seed, scope: `metric:${stageKey}` }, playerId)) {
        if (used.refs.has(name)) refs[name] = value;
      }
      // The draws of `seeded_rand`, per player as the evaluator scopes them (`metric:<stage>:<player>`).
      for (const key of drawKeys) refs[drawRef(key)] = seededRand(seed, `metric:${stageKey}:${playerId}`, key);
      playerRefs[playerId] = refs;
    }
  }

  // `rel()` in a metric answers from the links the public may see whole; a hidden side never reaches a standings table.
  const relations: Record<string, [string, string][]> = {};
  for (const key of used.relations) {
    const relation = (def.relations ?? []).find((r) => r.key === key);
    if (relation === undefined) continue;
    const pairs = publicLinkPairs(relation, state.links.filter((link) => link.relation === key));
    if (pairs.length > 0) relations[key] = pairs;
  }
  return { defs, placements, playerRefs, ...(Object.keys(relations).length > 0 ? { relations } : {}) };
}
