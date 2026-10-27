/**
 * The stage graph: stages are nodes, edges that resolve are arcs.
 *
 * - `order` is a Kahn topological order that is stable on declaration order (the lowest-index ready stage is
 *   taken first). Stages on a cycle, and stages that only hang off a cycle, never become ready and are left out.
 * - A cycle is reported once, rotated to start at its lowest-index stage (`a>b>a`); a self-loop is a cycle. The
 *   diagnostic points at the first edge, in document order, that lies on the cycle.
 * - Reachability starts at every roster stage. A stage that is neither a roster stage nor reachable can never
 *   receive participants.
 */
import { toMap } from '@/lib/studio-core/keys';
import type { FormatDefinition } from '../types';
import { diag, ptr, type Diagnostic } from './diagnostics';
import { fixUseEdgesSource } from './fixes';

export interface StageNode {
  key: string;
  index: number;
  incoming: string[];
  outgoing: string[];
  /** A roster stage: participants come from the roster, not from edges. */
  entry: boolean;
  /** Reachable from a roster stage (a roster stage is reachable by definition). */
  reachable: boolean;
}

export interface StageGraph {
  nodes: readonly StageNode[];
  order: readonly string[];
  cycle: readonly string[] | null;
}

export interface ResolvedEdge {
  /** Index into `definition.edges`. */
  index: number;
  from: string;
  to: string;
}

export interface GraphBuild {
  graph: StageGraph;
  /** Edges whose two ends are known stages, in document order. */
  edges: readonly ResolvedEdge[];
  /** Stages that never became ready: on a cycle or downstream of one. */
  blocked: ReadonlySet<string>;
  diagnostics: Diagnostic[];
}

function findCycle(keys: readonly string[], successors: ReadonlyMap<string, readonly string[]>): string[] | null {
  // Iterative three-colour DFS in declaration order; the first back edge closes the cycle.
  const color = new Map<string, 1 | 2>();
  for (const root of keys) {
    if (color.has(root)) continue;
    const path: string[] = [root];
    const cursor: number[] = [0];
    color.set(root, 1);
    while (path.length > 0) {
      const node = path[path.length - 1];
      const next = successors.get(node) ?? [];
      const at = cursor[cursor.length - 1];
      if (at >= next.length) {
        color.set(node, 2);
        path.pop();
        cursor.pop();
        continue;
      }
      cursor[cursor.length - 1] = at + 1;
      const target = next[at];
      const seen = color.get(target);
      if (seen === 1) return path.slice(path.indexOf(target));
      if (seen === undefined) {
        color.set(target, 1);
        path.push(target);
        cursor.push(0);
      }
    }
  }
  return null;
}

export function buildStageGraph(def: FormatDefinition): GraphBuild {
  const diagnostics: Diagnostic[] = [];
  const stageOf = toMap(def.stages.map((stage, index) => ({ stage, index })), (s) => s.stage.key);
  const keys: string[] = [...stageOf.values()].map((s) => s.stage.key);

  const resolved: ResolvedEdge[] = [];
  def.edges.forEach((edge, index) => {
    if (stageOf.has(edge.from) && stageOf.has(edge.to)) resolved.push({ index, from: edge.from, to: edge.to });
  });

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const key of keys) {
    incoming.set(key, []);
    outgoing.set(key, []);
  }
  for (const edge of resolved) {
    const out = outgoing.get(edge.from);
    const inn = incoming.get(edge.to);
    if (out && !out.includes(edge.to)) out.push(edge.to);
    if (inn && !inn.includes(edge.from)) inn.push(edge.from);
  }

  // Kahn, taking the lowest declaration index among the ready stages.
  const remaining = new Map<string, number>();
  for (const key of keys) remaining.set(key, incoming.get(key)?.length ?? 0);
  const order: string[] = [];
  const done = new Set<string>();
  for (;;) {
    const ready = keys.find((key) => !done.has(key) && remaining.get(key) === 0);
    if (ready === undefined) break;
    done.add(ready);
    order.push(ready);
    for (const next of outgoing.get(ready) ?? []) remaining.set(next, (remaining.get(next) ?? 0) - 1);
  }
  const blocked = new Set<string>(keys.filter((key) => !done.has(key)));

  let cycle: string[] | null = null;
  if (blocked.size > 0) {
    const found = findCycle(
      keys.filter((key) => blocked.has(key)),
      new Map(keys.map((key) => [key, (outgoing.get(key) ?? []).filter((n) => blocked.has(n))] as const)),
    );
    if (found !== null) {
      const indexOf = (key: string) => stageOf.get(key)?.index ?? 0;
      let start = 0;
      found.forEach((key, i) => {
        if (indexOf(key) < indexOf(found[start])) start = i;
      });
      cycle = [...found.slice(start), ...found.slice(0, start)];
      const members = cycle;
      const onCycle = (from: string, to: string) =>
        members.some((key, i) => key === from && members[(i + 1) % members.length] === to);
      const first = resolved.find((edge) => onCycle(edge.from, edge.to));
      diagnostics.push(
        diag('stage_cycle', first ? ptr('edges', first.index) : ptr('edges'), { path: [...members, members[0]].join('>') }),
      );
    }
  }

  // Reachability from the roster stages.
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const key of keys) {
    const stage = stageOf.get(key)?.stage;
    if (stage?.participants.from === 'roster') {
      reachable.add(key);
      queue.push(key);
    }
  }
  while (queue.length > 0) {
    const key = queue.shift() as string;
    for (const next of outgoing.get(key) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const nodes: StageNode[] = keys.map((key) => {
    const entry = stageOf.get(key);
    return {
      key,
      index: entry?.index ?? 0,
      incoming: [...(incoming.get(key) ?? [])],
      outgoing: [...(outgoing.get(key) ?? [])],
      entry: entry?.stage.participants.from === 'roster',
      reachable: reachable.has(key),
    };
  });

  for (const node of nodes) {
    const stage = def.stages[node.index];
    if (!node.entry && !node.reachable) {
      diagnostics.push(diag('stage_unreachable', ptr('stages', node.index), { stage: node.key }));
    }
    if (node.entry && node.incoming.length > 0) {
      diagnostics.push(
        diag('stage_roster_with_incoming', ptr('stages', node.index, 'participants'), { stage: node.key }, [
          fixUseEdgesSource(node.index, stage.participants.seeding),
        ]),
      );
    }
  }

  return { graph: { nodes, order, cycle }, edges: resolved, blocked, diagnostics };
}
