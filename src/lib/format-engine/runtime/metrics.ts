/**
 * The custom metrics of one stage as standings input (`KitStageMetrics`): the `metric.define` expressions of players,
 * the `score.placement` point tables of the stage, and the attribute, tunable and track values the expressions read.
 * Nothing here is secret (no seed, no relation), so the result may travel with `KitStandingsData`. Pure.
 */
import { childrenOf, type Expr, type ExprValue } from '@/lib/format-kit/expr/ast';
import type { FormatDefinition } from '@/lib/format-kit/types';
import type { KitStageMetrics } from '../context';
import { playerExtraRefMap } from './expr-env';
import { publicLinkPairs } from './relations';
import type { KitRuntimeState } from './types';

/** The relation keys the `rel()` calls of `exprs` name. */
function relationsUsedBy(exprs: readonly Expr[]): Set<string> {
  const used = new Set<string>();
  const stack: unknown[] = [...exprs];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    const { k, relation } = node as { k?: unknown; relation?: unknown };
    if (k === 'rel' && typeof relation === 'string') used.add(relation);
    stack.push(...childrenOf(node));
  }
  return used;
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
  for (const metric of def.metrics ?? []) {
    if (keys.has(metric.key)) continue;
    if (metric.kind === 'metric.define' && metric.of === 'player') defs.push({ key: metric.key, expr: metric.expr });
    else if (metric.kind === 'score.placement' && metric.stage === stageKey) placements.push({ key: metric.key, points: [...metric.points] });
    else continue;
    keys.add(metric.key);
  }
  if (defs.length === 0 && placements.length === 0) return undefined;

  const playerRefs: Record<string, Record<string, ExprValue>> = {};
  if (defs.length > 0) {
    for (const playerId of new Set(playerIds)) {
      playerRefs[playerId] = Object.fromEntries(playerExtraRefMap({ def, state, seed, scope: `metric:${stageKey}` }, playerId));
    }
  }

  // `rel()` in a metric answers from the links the public may see whole; a hidden side never reaches a standings table.
  const relations: Record<string, [string, string][]> = {};
  for (const key of relationsUsedBy(defs.map((d) => d.expr))) {
    const relation = (def.relations ?? []).find((r) => r.key === key);
    if (relation === undefined) continue;
    const pairs = publicLinkPairs(relation, state.links.filter((link) => link.relation === key));
    if (pairs.length > 0) relations[key] = pairs;
  }
  return { defs, placements, playerRefs, ...(Object.keys(relations).length > 0 ? { relations } : {}) };
}
