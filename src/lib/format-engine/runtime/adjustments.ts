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

/**
 * `rows` oldest first; `phaseOfStage` maps a stage key to the phase that runs it, or to all of its phases when a
 * `foreach_group` stage runs one phase per group. A rank row (the admin's order) applies to every phase of its stage:
 * the order lists players, and a phase ranks the ones it has. A points row names a player, who plays in one group
 * only: with several phases it goes to the phase(s) whose members (`membersOf`, phase id -> player ids) include the
 * player, and to none when no phase lists them. Without `membersOf` it goes to every phase of the stage.
 */
export function standingAdjustments(
  rows: readonly AdjustmentRow[],
  phaseOfStage: ReadonlyMap<string, string | readonly string[]>,
  membersOf?: ReadonlyMap<string, ReadonlySet<string>>,
): StandingAdjustments {
  const adjustments: Record<string, Record<string, number>> = {};
  const manualOrder: Record<string, string[]> = {};
  for (const row of rows) {
    if (!isRecord(row.target) || !isRecord(row.delta) || typeof row.target.stage !== 'string') continue;
    const mapped = phaseOfStage.get(row.target.stage);
    if (mapped === undefined) continue;
    const phases = typeof mapped === 'string' ? [mapped] : mapped;
    if (row.kind === 'points') {
      const { player_id: playerId } = row.target;
      const { points } = row.delta;
      if (typeof playerId !== 'string' || typeof points !== 'number' || !Number.isFinite(points)) continue;
      for (const phase of phases) {
        if (phases.length > 1 && membersOf !== undefined && membersOf.get(phase)?.has(playerId) !== true) continue;
        const byPlayer = adjustments[phase] ?? {};
        byPlayer[playerId] = (byPlayer[playerId] ?? 0) + points;
        adjustments[phase] = byPlayer;
      }
    } else if (Array.isArray(row.delta.order) && row.delta.order.every((id) => typeof id === 'string')) {
      for (const phase of phases) manualOrder[phase] = [...(row.delta.order as string[])];
    }
  }
  return { adjustments, manualOrder };
}
