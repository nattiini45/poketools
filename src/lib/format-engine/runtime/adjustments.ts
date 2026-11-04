/**
 * What the standings take from `format_adjustments`: the points added per player and stage, and the admin's order of
 * a stage (the latest `rank` row). Rows name a stage by its key; the standings data is keyed by phase id, so the caller
 * passes the key-to-phase map. A row that does not parse, or names a stage the league has not, is dropped. Pure.
 */
import type { Json } from '@/types/database';

export interface AdjustmentRow {
  kind: 'points' | 'rank';
  target: Json;
  delta: Json;
}

export interface StandingAdjustments {
  /** Phase id -> player id -> points added. */
  adjustments: Record<string, Record<string, number>>;
  /** Phase id -> player ids, best first. */
  manualOrder: Record<string, string[]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `rows` oldest first; `phaseOfStage` maps a stage key to the phase that runs it. */
export function standingAdjustments(rows: readonly AdjustmentRow[], phaseOfStage: ReadonlyMap<string, string>): StandingAdjustments {
  const adjustments: Record<string, Record<string, number>> = {};
  const manualOrder: Record<string, string[]> = {};
  for (const row of rows) {
    if (!isRecord(row.target) || !isRecord(row.delta) || typeof row.target.stage !== 'string') continue;
    const phase = phaseOfStage.get(row.target.stage);
    if (phase === undefined) continue;
    if (row.kind === 'points') {
      const { player_id: playerId } = row.target;
      const { points } = row.delta;
      if (typeof playerId !== 'string' || typeof points !== 'number' || !Number.isFinite(points)) continue;
      const byPlayer = adjustments[phase] ?? {};
      byPlayer[playerId] = (byPlayer[playerId] ?? 0) + points;
      adjustments[phase] = byPlayer;
    } else if (Array.isArray(row.delta.order) && row.delta.order.every((id) => typeof id === 'string')) {
      manualOrder[phase] = [...(row.delta.order as string[])];
    }
  }
  return { adjustments, manualOrder };
}
