/**
 * Track progression (`track.progression`): a ladder of steps a player climbs by completed matches. A completed match
 * moves a player up at most one step: the next step is reached when its `when` (match env) is true for that match.
 * The returned `set_track` ops carry the new step count; the database only ever raises a step. Pure and client-safe.
 */
import { evaluate } from '@/lib/format-kit/expr/eval';
import type { EvalContext } from '@/lib/format-kit/expr/ast';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { own, type FormatOp, type KitRuntimeState, type RuntimeIssue } from './types';

export interface TrackMatchInput {
  /** The stage the match belongs to; a track bound to another stage ignores it. */
  stage: string;
  /** One match env per side of the completed match. */
  players: readonly { playerId: string; ctx: EvalContext }[];
}

export interface TrackPlan {
  ops: FormatOp[];
  issues: RuntimeIssue[];
}

export function planTrackProgress(def: Pick<FormatDefinition, 'metrics'>, input: TrackMatchInput, state: Pick<KitRuntimeState, 'tracks'>): TrackPlan {
  const ops: FormatOp[] = [];
  const issues: RuntimeIssue[] = [];
  const seen = new Set<string>();
  for (const metric of def.metrics ?? []) {
    if (metric.kind !== 'track.progression' || seen.has(metric.key)) continue;
    seen.add(metric.key);
    if (metric.stage !== undefined && metric.stage !== input.stage) continue;
    for (const { playerId, ctx } of input.players) {
      const reached = own(own(state.tracks, playerId), metric.key) ?? 0;
      const next = metric.steps[reached];
      if (next === undefined) continue;
      const result = evaluate(next.when, ctx, 'boolean');
      if (!result.ok) {
        issues.push({ code: 'step_failed', rule: metric.key, detail: result.issue.code });
        continue;
      }
      if (result.value === true) ops.push({ op: 'set_track', track: metric.key, player_id: playerId, step: reached + 1 });
    }
  }
  return { ops, issues };
}
