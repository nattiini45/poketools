import { describe, expect, it } from 'vitest';
import { buildStageGraph } from '../engine/graph';
import { makeDefinition, makeEdge, makeRosterStage, makeStage } from './fixtures/negative';

const codes = (build: ReturnType<typeof buildStageGraph>) => build.diagnostics.map((d) => d.code);

describe('stage graph', () => {
  it('orders stages by dependency and keeps declaration order among the ready ones', () => {
    const def = makeDefinition(
      [makeRosterStage('r'), makeStage('b'), makeStage('c'), makeStage('a')],
      [makeEdge('e1', 'r', 'c'), makeEdge('e2', 'r', 'b'), makeEdge('e3', 'r', 'a')],
    );
    const { graph } = buildStageGraph(def);
    expect(graph.order).toEqual(['r', 'b', 'c', 'a']);
    expect(graph.cycle).toBeNull();
  });

  it('puts a late-declared source before its target', () => {
    const def = makeDefinition([makeStage('last'), makeRosterStage('first')], [makeEdge('e', 'first', 'last')]);
    expect(buildStageGraph(def).graph.order).toEqual(['first', 'last']);
  });

  it('resolves a diamond', () => {
    const def = makeDefinition(
      [makeRosterStage('r'), makeStage('a'), makeStage('b'), makeStage('d')],
      [makeEdge('e1', 'r', 'a'), makeEdge('e2', 'r', 'b'), makeEdge('e3', 'a', 'd'), makeEdge('e4', 'b', 'd')],
    );
    const build = buildStageGraph(def);
    expect(build.graph.order).toEqual(['r', 'a', 'b', 'd']);
    expect(build.graph.nodes.find((n) => n.key === 'd')?.incoming).toEqual(['a', 'b']);
    expect(build.diagnostics).toEqual([]);
  });

  it('reports a cycle once, rotated to its first stage, at the first edge on it', () => {
    const def = makeDefinition(
      [makeRosterStage('s0'), makeStage('b'), makeStage('c')],
      [makeEdge('in', 's0', 'b'), makeEdge('e2', 'b', 'c'), makeEdge('e3', 'c', 'b')],
    );
    const build = buildStageGraph(def);
    expect(build.graph.cycle).toEqual(['b', 'c']);
    const cycle = build.diagnostics.filter((d) => d.code === 'stage_cycle');
    expect(cycle).toHaveLength(1);
    expect(cycle[0].json_pointer).toBe('/edges/1');
    expect(cycle[0].params).toEqual({ path: 'b>c>b' });
    expect(build.graph.order).toEqual(['s0']);
    expect([...build.blocked].sort()).toEqual(['b', 'c']);
  });

  it('treats a self loop as a cycle', () => {
    const def = makeDefinition([makeRosterStage('a')], [makeEdge('loop', 'a', 'a')]);
    const build = buildStageGraph(def);
    expect(build.graph.cycle).toEqual(['a']);
    expect(build.diagnostics.find((d) => d.code === 'stage_cycle')?.params).toEqual({ path: 'a>a' });
  });

  it('blocks a stage that only hangs off a cycle without calling it part of the cycle', () => {
    const def = makeDefinition(
      [makeRosterStage('a'), makeStage('b'), makeStage('tail')],
      [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'a'), makeEdge('e3', 'b', 'tail')],
    );
    const build = buildStageGraph(def);
    expect(build.graph.cycle).toEqual(['a', 'b']);
    expect(build.blocked.has('tail')).toBe(true);
  });

  it('flags a stage that no roster stage reaches, including a chain of them', () => {
    const def = makeDefinition(
      [makeRosterStage('r'), makeStage('x'), makeStage('y')],
      [makeEdge('e1', 'x', 'y')],
    );
    const unreachable = buildStageGraph(def).diagnostics.filter((d) => d.code === 'stage_unreachable');
    expect(unreachable.map((d) => d.json_pointer)).toEqual(['/stages/1', '/stages/2']);
    expect(unreachable.map((d) => d.params.stage)).toEqual(['x', 'y']);
  });

  it('leaves disconnected roster stages alone', () => {
    const def = makeDefinition([makeRosterStage('one'), makeRosterStage('two')]);
    const build = buildStageGraph(def);
    expect(build.diagnostics).toEqual([]);
    expect(build.graph.nodes.every((n) => n.entry && n.reachable)).toBe(true);
    expect(build.graph.order).toEqual(['one', 'two']);
  });

  it('warns about a roster stage with incoming edges and offers to take the edges instead', () => {
    const def = makeDefinition([makeRosterStage('a'), makeRosterStage('b')], [makeEdge('e', 'a', 'b')]);
    const [warning] = buildStageGraph(def).diagnostics;
    expect(warning.code).toBe('stage_roster_with_incoming');
    expect(warning.severity).toBe('warning');
    expect(warning.json_pointer).toBe('/stages/1/participants');
    expect(warning.fixes[0].id).toBe('use_edges_source');
    expect(warning.fixes[0].patch).toEqual([
      { op: 'replace', path: '/stages/1/participants', value: { from: 'edges', seeding: 'edge_order' } },
    ]);
  });

  it('ignores edges to or from stages that do not exist, and keeps the first of two equal keys', () => {
    const def = makeDefinition(
      [makeRosterStage('a'), makeStage('a'), makeStage('b')],
      [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'a', 'ghost'), makeEdge('e3', 'ghost', 'b')],
    );
    const build = buildStageGraph(def);
    expect(build.graph.nodes.map((n) => n.key)).toEqual(['a', 'b']);
    expect(build.edges.map((e) => e.index)).toEqual([0]);
    expect(codes(build)).toEqual([]);
  });

  it('works with stage keys that are Object.prototype member names', () => {
    const def = makeDefinition([makeRosterStage('constructor'), makeStage('toString')], [makeEdge('e', 'constructor', 'toString')]);
    const build = buildStageGraph(def);
    expect(build.graph.order).toEqual(['constructor', 'toString']);
    expect(build.diagnostics).toEqual([]);
  });
});
