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
 * id on the other side is filled in, as they know it anyway. The result is sorted by the visible fields only.
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
  return out.sort(compareVisible);
}

/**
 * Orders links by what the viewer sees of them and nothing else. Links are generated and stored sorted by `from`, so
 * the order in which they arrive would give a hidden `from` away by position (the n-th target belongs to the n-th
 * player). A viewer's list is therefore sorted on the visible fields only (a hidden side sorts as empty).
 */
function compareVisible(x: VisibleLink, y: VisibleLink): number {
  const key = (link: VisibleLink): string => `${link.from ?? ''}\u0000${link.to ?? ''}\u0000${link.revealed ? 1 : 0}`;
  const a = key(x);
  const b = key(y);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The `[from, to]` pairs of a relation that anybody may see whole, with no account: what a public surface (the public
 * standings table) may let `rel()` answer from. A link with a hidden side is left out, so `rel()` answers false for it.
 */
export function publicLinkPairs(
  relation: Pick<RelationDef, 'visibility'>,
  links: readonly { from: string; to: string; revealed: boolean }[],
): [string, string][] {
  const pairs: [string, string][] = [];
  for (const link of visibleLinks(relation, links, { playerId: null, admin: false })) {
    if (link.from !== null && link.to !== null) pairs.push([link.from, link.to]);
  }
  return pairs;
}

/**
 * Whether `links` is an acceptable hand-set link list for a relation of `shape` over `roster` (an admin sets links with
 * a `relation` adjustment). The common rules guard what the table's keys and checks would otherwise answer with a raw
 * database error: every end is on the roster, nobody links to themself, each player gives at most once and receives at
 * most once. On top of that:
 * - `derangement`: a permutation of the whole roster in a single cycle (what `generateRelationLinks` draws), so every
 *   player gives and receives once and the chain closes; with fewer than two players there are no links;
 * - `pairs`: every link has its reverse, and at most one player of the roster is left without a partner;
 * - `manual`: nothing more.
 * An empty list is valid for `manual` and where the generator itself would draw none (fewer than two players).
 */
export function validateRelationLinks(
  shape: RelationDef['shape'],
  roster: readonly string[],
  links: readonly LinkPair[],
): boolean {
  const members = new Set(roster);
  const nextOf = new Map<string, string>();
  const receivers = new Set<string>();
  for (const { from, to } of links) {
    if (from === to || !members.has(from) || !members.has(to)) return false;
    if (nextOf.has(from) || receivers.has(to)) return false;
    nextOf.set(from, to);
    receivers.add(to);
  }
  switch (shape) {
    case 'manual':
      return true;
    case 'derangement': {
      if (members.size < 2) return links.length === 0;
      if (links.length !== members.size) return false;
      // Every player gives once (unique `from` over a full-size list), so following the chain from any player must
      // visit the whole roster before it closes.
      const start = [...members][0];
      let at = start;
      for (let visited = 1; visited < members.size; visited += 1) {
        at = nextOf.get(at) ?? '';
        if (at === start || !members.has(at)) return false;
      }
      return nextOf.get(at) === start;
    }
    case 'pairs': {
      if (members.size < 2) return links.length === 0;
      if (members.size - links.length !== (members.size % 2)) return false;
      return links.every((link) => nextOf.get(link.to) === link.from);
    }
  }
}
