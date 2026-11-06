/**
 * Reads a stored adjustment (`target` and `delta` are JSON the library wrote) into the few facts a history row shows.
 * A row of a shape this does not know becomes `unknown` and shows its kind only. Pure and client-safe.
 */
import type { AdjustmentView } from '@/lib/format-engine/runtime/view-types';
import type { Json } from '@/types/database';

type Obj = { [key: string]: Json | undefined };

const isObj = (value: Json | undefined): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: Json | undefined): string | null => (typeof value === 'string' && value !== '' ? value : null);
const num = (value: Json | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const count = (value: Json | undefined): number => (Array.isArray(value) ? value.length : 0);

export type AdjustmentFacts =
  | { kind: 'points'; stage: string; player: string; points: number }
  | { kind: 'rank'; stage: string; players: number }
  | { kind: 'resource'; resource: string; player: string; item: string | null; amount: number }
  | { kind: 'relation'; relation: string; reveal: boolean; draw: boolean; linkCount: number | null }
  | { kind: 'action'; action: string; state: 'open' | 'locked' }
  | { kind: 'domain'; domain: string; added: number; removed: number }
  | { kind: 'outcome'; matchId: string }
  | { kind: 'unknown' };

export function adjustmentFacts(row: Pick<AdjustmentView, 'kind' | 'target' | 'delta'>): AdjustmentFacts {
  const { target, delta } = row;
  if (!isObj(target) || !isObj(delta)) return { kind: 'unknown' };
  switch (row.kind) {
    case 'points': {
      const stage = text(target.stage);
      const player = text(target.player_id);
      const points = num(delta.points);
      return stage === null || player === null || points === null ? { kind: 'unknown' } : { kind: 'points', stage, player, points };
    }
    case 'rank': {
      const stage = text(target.stage);
      return stage === null ? { kind: 'unknown' } : { kind: 'rank', stage, players: count(delta.order) };
    }
    case 'resource': {
      const resource = text(target.resource);
      const player = text(target.player_id);
      const amount = num(delta.amount);
      return resource === null || player === null || amount === null
        ? { kind: 'unknown' }
        : { kind: 'resource', resource, player, item: text(target.item_id), amount };
    }
    case 'relation': {
      const relation = text(target.relation);
      return relation === null
        ? { kind: 'unknown' }
        : { kind: 'relation', relation, reveal: delta.reveal === true, draw: delta.draw === true, linkCount: num(delta.link_count) };
    }
    case 'action': {
      const action = text(target.action);
      const state = delta.state;
      return action === null || (state !== 'open' && state !== 'locked') ? { kind: 'unknown' } : { kind: 'action', action, state };
    }
    case 'domain': {
      const domain = text(target.domain);
      return domain === null ? { kind: 'unknown' } : { kind: 'domain', domain, added: count(delta.add), removed: count(delta.remove) };
    }
    case 'outcome': {
      const matchId = text(target.match_id);
      return matchId === null ? { kind: 'unknown' } : { kind: 'outcome', matchId };
    }
    default:
      return { kind: 'unknown' };
  }
}
