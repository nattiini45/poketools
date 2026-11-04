/**
 * Placement scores (`score.placement`): points by final place in a stage's table. Place 1 gets `points[0]`; a place
 * past the list gets 0. Pure and client-safe.
 */
import type { FormatDefinition } from '@/lib/format-kit/types';

export interface PlacementTable {
  player_id: string;
  /** Place in the table, 1-based. */
  rank: number;
}

/** Per placement metric of `stageKey`: the points of every player of the table. */
export function placementPoints(
  def: Pick<FormatDefinition, 'metrics'>,
  stageKey: string,
  table: readonly PlacementTable[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const metric of def.metrics ?? []) {
    if (metric.kind !== 'score.placement' || metric.stage !== stageKey || Object.prototype.hasOwnProperty.call(out, metric.key)) continue;
    const byPlayer: Record<string, number> = {};
    for (const row of table) byPlayer[row.player_id] = metric.points[row.rank - 1] ?? 0;
    out[metric.key] = byPlayer;
  }
  return out;
}

/** The same points per player, then per metric key: the shape `StageStandingsInput.customMetrics` takes. */
export function placementByPlayer(
  def: Pick<FormatDefinition, 'metrics'>,
  stageKey: string,
  table: readonly PlacementTable[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [key, byPlayer] of Object.entries(placementPoints(def, stageKey, table))) {
    for (const [playerId, points] of Object.entries(byPlayer)) {
      const entry = out[playerId] ?? {};
      entry[key] = points;
      out[playerId] = entry;
    }
  }
  return out;
}
