/**
 * The plan: how many participants each stage receives, how they split into groups, how many rounds the stage
 * plays and how big its bracket is. Everything is a pure function of the definition and the environment.
 *
 * Counts are ranges (`min`..`max`) because a threshold selection or an unknown source narrows nothing. A count
 * the plan cannot know is `null`, and a check that needs a count simply does not run without it.
 *
 * Conventions (documented in docs/format-kit.md):
 * - An elimination stage with a third-place match keeps it inside the final round: no extra round is counted.
 * - A double-elimination stage plays `2 * ceil(log2 n) - 1` rounds, plus one when the bracket reset is on.
 * - Round robin plays `legs * getRoundRobinTotalRounds(group size)` rounds (fewer than two players: none).
 * - Edge targets add up their incoming edges and assume the selections are disjoint.
 */
import { getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import type { AdvanceSelect, FormatDefinition, Stage } from '../types';
import { diag, ptr, type Diagnostic } from './diagnostics';
import type { CompileEnv } from './env';
import type { GraphBuild } from './graph';

export interface CountRange {
  min: number;
  max: number;
}

export interface StagePlan {
  key: string;
  participants: CountRange | null;
  groupSize: CountRange | null;
  rounds: CountRange | null;
  bracketSize: number | null;
  byes: number | null;
  mappedBracketType: 'round_robin' | 'swiss' | 'single_elim' | 'double_elim';
}

export type CountSource = 'roster' | 'expected_count' | 'edges';

export interface PlanBuild {
  /** One entry per distinct stage key, in declaration order. */
  plan: StagePlan[];
  byKey: ReadonlyMap<string, StagePlan>;
  /** Where a stage's participant count comes from (only for stages with a known count). */
  sources: ReadonlyMap<string, CountSource>;
  /** Participants an edge sends on, by edge index; `null` when unknown. */
  outflow: ReadonlyMap<number, CountRange | null>;
  diagnostics: Diagnostic[];
}

export function exact(n: number): CountRange {
  return { min: n, max: n };
}

export function isExact(range: CountRange): boolean {
  return range.min === range.max;
}

function addRanges(a: CountRange, b: CountRange): CountRange {
  return { min: a.min + b.min, max: a.max + b.max };
}

/** `min`/`max` of `f` over the integers of a range (all of them when small, the ends otherwise). */
export function mapRange(range: CountRange, f: (n: number) => number): CountRange {
  const points: number[] = [];
  if (range.max - range.min <= 4096) {
    for (let n = range.min; n <= range.max; n += 1) points.push(f(n));
  } else {
    for (const n of [range.min, range.min + 1, range.max - 1, range.max]) points.push(f(n));
  }
  return { min: Math.min(...points), max: Math.max(...points) };
}

export function ceilLog2(n: number): number {
  let power = 1;
  let log = 0;
  while (power < n) {
    power *= 2;
    log += 1;
  }
  return log;
}

export function nextPowerOfTwo(n: number): number {
  return 2 ** ceilLog2(n);
}

export function isElimination(stage: Stage): boolean {
  return stage.pairing.kind === 'single_elim' || stage.pairing.kind === 'double_elim';
}

/** The number of players a fixed selection asks for, or `null` for an expression or an open list. */
export function fixedRequest(select: AdvanceSelect, source: Stage): number | null {
  switch (select.kind) {
    case 'top_n':
    case 'wildcard':
    case 'bottom_n':
      return select.n;
    case 'per_group':
      return source.groups ? select.n * source.groups.count : null;
    case 'manual_list':
      return select.count ?? null;
    default:
      return null;
  }
}

/** Participants one selection sends on, given the source stage's count. */
export function selectOutflow(select: AdvanceSelect, source: Stage, sourceCount: CountRange | null): CountRange | null {
  switch (select.kind) {
    case 'top_n':
      return sourceCount ? { min: Math.min(select.n, sourceCount.min), max: Math.min(select.n, sourceCount.max) } : null;
    case 'threshold':
      return sourceCount ? { min: 0, max: sourceCount.max } : null;
    default: {
      const fixed = fixedRequest(select, source);
      return fixed === null ? null : exact(fixed);
    }
  }
}

function rosterCount(stage: Stage, env: CompileEnv): { count: CountRange; source: CountSource } | null {
  const size = env.rosterSize;
  if (size !== undefined && Number.isSafeInteger(size) && size >= 0) return { count: exact(size), source: 'roster' };
  if (stage.participants.from === 'roster' && stage.participants.expected_count !== undefined) {
    return { count: exact(stage.participants.expected_count), source: 'expected_count' };
  }
  return null;
}

function roundsOf(stage: Stage, participants: CountRange | null, groupSize: CountRange | null): CountRange | null {
  const pairing = stage.pairing;
  switch (pairing.kind) {
    case 'round_robin': {
      const size = stage.groups ? groupSize : participants;
      if (!size) return null;
      return mapRange(size, (n) => (n < 2 ? 0 : pairing.legs * getRoundRobinTotalRounds(n)));
    }
    case 'swiss':
      if (pairing.rounds !== 'auto') return exact(pairing.rounds);
      return participants ? mapRange(participants, (n) => (n < 2 ? 0 : ceilLog2(n))) : null;
    case 'single_elim':
      return participants ? mapRange(participants, (n) => (n < 2 ? 0 : ceilLog2(n))) : null;
    case 'double_elim':
      return participants
        ? mapRange(participants, (n) => (n < 2 ? 0 : 2 * ceilLog2(n) - 1 + (pairing.bracket_reset ? 1 : 0)))
        : null;
    default:
      return null;
  }
}

function bracketOf(participants: CountRange | null): { size: number | null; byes: number | null } {
  if (!participants || participants.max < 2) return { size: null, byes: null };
  if (isExact(participants)) {
    const size = nextPowerOfTwo(participants.min);
    return { size, byes: size - participants.min };
  }
  const low = nextPowerOfTwo(Math.max(2, participants.min));
  const high = nextPowerOfTwo(participants.max);
  return { size: low === high ? low : null, byes: null };
}

function buildStagePlan(stage: Stage, participants: CountRange | null): StagePlan {
  let groupSize: CountRange | null = null;
  if (stage.groups && participants) {
    const count = stage.groups.count;
    groupSize = { min: Math.floor(participants.min / count), max: Math.ceil(participants.max / count) };
  }
  const bracket = isElimination(stage) ? bracketOf(participants) : { size: null, byes: null };
  const kind = stage.pairing.kind;
  return {
    key: stage.key,
    participants,
    groupSize,
    rounds: roundsOf(stage, participants, groupSize),
    bracketSize: bracket.size,
    byes: bracket.byes,
    mappedBracketType: kind === 'manual' ? 'round_robin' : kind,
  };
}

export function buildPlan(def: FormatDefinition, env: CompileEnv, graphBuild: GraphBuild): PlanBuild {
  const diagnostics: Diagnostic[] = [];
  const byKey = new Map<string, StagePlan>();
  const sources = new Map<string, CountSource>();
  const outflow = new Map<number, CountRange | null>();
  const stageByKey = new Map<string, { stage: Stage; index: number }>();
  def.stages.forEach((stage, index) => {
    if (!stageByKey.has(stage.key)) stageByKey.set(stage.key, { stage, index });
  });

  const counts = new Map<string, CountRange | null>();
  const incomingEdges = new Map<string, number[]>();
  for (const edge of graphBuild.edges) {
    const list = incomingEdges.get(edge.to);
    if (list) list.push(edge.index);
    else incomingEdges.set(edge.to, [edge.index]);
  }

  const settle = (key: string): void => {
    const entry = stageByKey.get(key);
    if (!entry) return;
    const { stage, index } = entry;
    let count: CountRange | null = null;
    if (stage.participants.from === 'roster') {
      const roster = rosterCount(stage, env);
      if (roster) {
        count = roster.count;
        sources.set(key, roster.source);
      } else {
        diagnostics.push(diag('participant_count_unknown', ptr('stages', index, 'participants'), { stage: key }));
      }
    } else if (!graphBuild.blocked.has(key)) {
      let total: CountRange | null = exact(0);
      for (const edgeIndex of incomingEdges.get(key) ?? []) {
        const flow = outflow.get(edgeIndex) ?? null;
        total = total && flow ? addRanges(total, flow) : null;
      }
      if (total && (incomingEdges.get(key)?.length ?? 0) > 0) {
        count = total;
        sources.set(key, 'edges');
      }
    }
    counts.set(key, count);
    // Outgoing edges: the source count is final once the stage is settled.
    for (const edge of graphBuild.edges) {
      if (edge.from !== key) continue;
      const edgeDef = def.edges[edge.index];
      let total: CountRange | null = exact(0);
      edgeDef.select.forEach((select, j) => {
        if (select.kind === 'per_group' && !stage.groups) {
          diagnostics.push(
            diag('advance_per_group_without_groups', ptr('edges', edge.index, 'select', j), {
              edge: edgeDef.key,
              stage: key,
            }),
          );
        }
        const part = selectOutflow(select, stage, count);
        total = total && part ? addRanges(total, part) : null;
      });
      outflow.set(edge.index, total);
    }
  };

  for (const key of graphBuild.graph.order) settle(key);
  for (const node of graphBuild.graph.nodes) {
    if (graphBuild.blocked.has(node.key)) settle(node.key);
  }

  for (const node of graphBuild.graph.nodes) {
    const entry = stageByKey.get(node.key);
    if (!entry) continue;
    const plan = buildStagePlan(entry.stage, counts.get(node.key) ?? null);
    byKey.set(node.key, plan);
  }

  return { plan: [...byKey.values()], byKey, sources, outflow, diagnostics };
}
