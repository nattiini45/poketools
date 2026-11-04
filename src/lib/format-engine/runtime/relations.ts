/**
 * Relations between players (a secret santa is a derangement). Generation is seeded: the links depend on the season
 * seed and the sorted roster only, so a re-run draws the same links. `visibleLinks` is the one place that decides
 * which side of a link a viewer may learn; a hidden side never leaves it, so a public or per-player payload built
 * from its result cannot leak it. Pure and client-safe.
 */
import { seededRand } from '@/lib/format-kit/expr/rand';
import type { RelationDef } from '@/lib/format-kit/types';

export interface LinkPair {
  from: string;
  to: string;
}

const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/** A seeded Sattolo shuffle of 0..n-1: one cycle of length n, so no index maps to itself. */
function sattolo(n: number, seed: string, scope: string): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i >= 1; i -= 1) {
    const j = Math.floor(seededRand(seed, scope, `sattolo:${i}`) * i);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}

function shuffled<T>(items: readonly T[], seed: string, scope: string): T[] {
  const out = [...items];
  for (let i = out.length - 1; i >= 1; i -= 1) {
    const j = Math.floor(seededRand(seed, scope, `shuffle:${i}`) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The links of a relation for `playerIds` (sorted by id first):
 * - `derangement`: every player gives to one player and receives from one, nobody to themself, all in a single cycle;
 *   fewer than two players give none;
 * - `pairs`: a seeded shuffle, consecutive players linked both ways; an odd player is left out;
 * - `manual`: none, an admin sets them.
 */
export function generateRelationLinks(relation: Pick<RelationDef, 'key' | 'shape'>, playerIds: readonly string[], seed: string): LinkPair[] {
  const ids = sortedUnique(playerIds);
  const scope = `relation:${relation.key}`;
  switch (relation.shape) {
    case 'derangement': {
      if (ids.length < 2) return [];
      const perm = sattolo(ids.length, seed, scope);
      return ids.map((from, i) => ({ from, to: ids[perm[i]] }));
    }
    case 'pairs': {
      const order = shuffled(ids, seed, scope);
      const out: LinkPair[] = [];
      for (let i = 0; i + 1 < order.length; i += 2) {
        out.push({ from: order[i], to: order[i + 1] }, { from: order[i + 1], to: order[i] });
      }
      return out;
    }
    case 'manual':
      return [];
  }
}

export interface Viewer {
  playerId: string | null;
  admin: boolean;
}

/** A link as a viewer may see it: a side the viewer may not learn is null. */
export interface VisibleLink {
  from: string | null;
  to: string | null;
  revealed: boolean;
}

/**
 * The links `viewer` may see. Admins see every link whole. For anyone else, once a link is revealed both sides are
 * public; before that the `to` side (the target) is seen per `visibility.to` and the `from` side (the source) per
 * `visibility.from`: `all` everyone, `own` only the other end of the link (the source sees the target, the target
 * sees the source), `hidden` nobody. A link shows up only when the viewer may learn one of its sides; the viewer's own
 * id on the other side is filled in, as they know it anyway.
 */
export function visibleLinks(
  relation: Pick<RelationDef, 'visibility'>,
  links: readonly { from: string; to: string; revealed: boolean }[],
  viewer: Viewer,
): VisibleLink[] {
  if (viewer.admin) return links.map((link) => ({ from: link.from, to: link.to, revealed: link.revealed }));
  const out: VisibleLink[] = [];
  for (const link of links) {
    const isFrom = viewer.playerId !== null && viewer.playerId === link.from;
    const isTo = viewer.playerId !== null && viewer.playerId === link.to;
    const seesTo = link.revealed || relation.visibility.to === 'all' || (relation.visibility.to === 'own' && isFrom);
    const seesFrom = link.revealed || relation.visibility.from === 'all' || (relation.visibility.from === 'own' && isTo);
    if (!seesTo && !seesFrom) continue;
    out.push({
      from: seesFrom || isFrom ? link.from : null,
      to: seesTo || isTo ? link.to : null,
      revealed: link.revealed,
    });
  }
  return out;
}
