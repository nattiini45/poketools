import { describe, expect, it } from 'vitest';

import { scoreStack, wildcardMatches } from '../grader-stack';
import { expectSchema, SNAPSHOT_TABLES, type Expect, type StackObservation } from '../types';

/**
 * The grading of the local stack's observation (plan 7.2 "the grader finds what the assistant created from the ledger, asserts
 * exact count deltas, and asserts that nothing outside the ledger changed in those tables"): pure, so the observation is built here.
 */
const counts = (deltas: Partial<Record<(typeof SNAPSHOT_TABLES)[number], number>> = {}): StackObservation['counts'] =>
  Object.fromEntries(SNAPSHOT_TABLES.map((table) => [table, { before: 10, after: 10 + (deltas[table] ?? 0) }])) as StackObservation['counts'];

const observation = (patch: Partial<StackObservation> = {}): StackObservation => ({
  counts: counts(),
  rows: [],
  recorder: { beforeApprove: [], afterApprove: [] },
  ledger: [],
  proposals: [],
  clicks: [],
  ...patch,
});

const parse = (expect: unknown): Expect => expectSchema.parse(expect);
const failed = (expectation: unknown, stack: StackObservation | undefined): string[] => scoreStack(parse(expectation), stack).filter((c) => !c.pass).map((c) => c.name);

describe('db counts', () => {
  it('passes the exact deltas, and any table the case does not list must not change', () => {
    const stack = observation({ counts: counts({ seasons: 1, tournaments: 2 }) });
    expect(failed({ db: { counts: { seasons: 1, tournaments: 2 } } }, stack)).toEqual([]);
    // A third table moved that the case never named.
    expect(failed({ db: { counts: { seasons: 1 } } }, stack)).toEqual(['tournaments count change is +0']);
    expect(failed({ db: { counts: { seasons: 2, tournaments: 2 } } }, stack)).toEqual(['seasons count change is +2']);
  });

  it('names a missing snapshot instead of passing quietly', () => {
    expect(failed({ db: { counts: {} } }, observation({ counts: {} }))).toHaveLength(SNAPSHOT_TABLES.length);
  });
});

describe('db rows', () => {
  const row = { id: 'a', name: 'LG9 Cup x', status: 'upcoming', resolved: { pokemon: { mode: 'block', ids: ['a', 'b'] } } };
  const found = (rows: Array<Record<string, unknown>>) => observation({ rows: [{ table: 'seasons', found: rows as never }] });

  it('counts the rows found by the case-id name and compares fields, including a dotted path into a JSON column', () => {
    const spec = { table: 'seasons', where: { name: 'LG9 Cup x' }, fields: { status: 'upcoming', 'resolved.pokemon': { mode: 'block', ids: ['a', 'b'] } } };
    expect(failed({ db: { rows: [spec] } }, found([row]))).toEqual([]);
    expect(failed({ db: { rows: [spec] } }, found([]))).toContain('seasons {"name":"LG9 Cup x"}: 1 row(s)');
    expect(failed({ db: { rows: [spec] } }, found([row, row]))).toContain('seasons {"name":"LG9 Cup x"}: 1 row(s)');
    expect(failed({ db: { rows: [{ ...spec, fields: { status: 'active' } }] } }, found([row]))).toEqual(['seasons {"name":"LG9 Cup x"}: status = "active"']);
    expect(failed({ db: { rows: [{ ...spec, fields: { 'resolved.pokemon': { mode: 'block', ids: ['a'] } } }] } }, found([row]))).toHaveLength(1);
  });

  it('accepts an explicit count of zero and reports a row the harness did not read', () => {
    expect(failed({ db: { rows: [{ table: 'seasons', where: { name: 'x' }, count: 0 }] } }, found([]))).toEqual([]);
    expect(failed({ db: { rows: [{ table: 'seasons', where: { name: 'x' }, count: 1 }] } }, observation())).toEqual(['row seasons {"name":"x"}']);
  });
});

describe('recorders', () => {
  const event = (channel: 'discord' | 'social' | 'cache', name: string) => ({ channel, name });

  it('holds the outward events before the first approve to the case count (default none) and ignores cache expiry there', () => {
    const quiet = observation({ recorder: { beforeApprove: [event('cache', 'tag:seasons')], afterApprove: [] } });
    expect(failed({ recorder: {} }, quiet)).toEqual([]);
    const early = observation({ recorder: { beforeApprove: [event('discord', 'round_generated')], afterApprove: [] } });
    expect(failed({ recorder: {} }, early)).toEqual(['0 outward event(s) before the first approve']);
    expect(failed({ recorder: { beforeApprove: 1 } }, early)).toEqual([]);
  });

  it('compares the Discord and social event names after the approve exactly and in order', () => {
    const after = observation({
      recorder: {
        beforeApprove: [],
        afterApprove: [event('discord', 'round_generated'), event('social', 'round_generated'), event('discord', 'tournament_started'), event('cache', 'tag:season:1')],
      },
    });
    expect(failed({ recorder: { events: ['round_generated', 'tournament_started'], social: ['round_generated'], expiredTags: ['season:*'] } }, after)).toEqual([]);
    expect(failed({ recorder: { events: ['tournament_started', 'round_generated'] } }, after)).toHaveLength(1);
    expect(failed({ recorder: { events: ['round_generated'] } }, after)).toHaveLength(1);
    expect(failed({ recorder: { events: [] } }, observation())).toEqual([]);
    expect(failed({ recorder: { expiredTags: ['tournament:*'] } }, after)).toEqual(['expires cache tag tournament:*']);
  });

  it('matches cache tags with a star for any characters and nothing else', () => {
    expect(wildcardMatches('season:*', 'season:abc')).toBe(true);
    expect(wildcardMatches('season:*', 'seasons')).toBe(false);
    expect(wildcardMatches('a.b', 'axb')).toBe(false);
  });
});

describe('ledger, proposals and clicks', () => {
  const stack = observation({
    ledger: [
      { proposalId: 'p', op: 'league_create', stepKey: 'league', status: 'ok', code: null },
      { proposalId: 'p', op: 'phase_create', stepKey: 'a', status: 'ok', code: null },
      { proposalId: 'p', op: 'phase_create', stepKey: 'b', status: 'unknown', code: 'unknown_outcome' },
    ],
    proposals: [
      { id: 'p', tool: 'propose_build', kind: 'build', class: 'B', status: 'executing' },
      { id: 'q', tool: 'propose_undo', kind: 'undo', class: 'G', status: 'completed' },
    ],
    clicks: [
      { turn: 0, kind: 'approve', status: 200, code: 'ok', proposalId: 'p', result: 'executing' },
      { turn: 0, kind: 'approve', status: 409, code: 'proposal_not_pending', proposalId: 'p', result: null },
    ],
  });

  it('checks ledger rows by op, status, code and count, and that an op has no row', () => {
    expect(failed({ ledger: { steps: [{ op: 'league_create', status: 'ok', count: 1 }, { op: 'phase_create', status: 'unknown', code: 'unknown_outcome' }], total: 3, none: ['league_archive'] } }, stack)).toEqual([]);
    expect(failed({ ledger: { steps: [{ op: 'phase_create', status: 'ok', count: 2 }] } }, stack)).toEqual(['ledger phase_create ok x2']);
    expect(failed({ ledger: { total: 2, none: ['phase_create'] } }, stack)).toEqual(['ledger holds 2 row(s)', 'ledger has no phase_create row']);
  });

  it('checks the proposal rows by position and by kind, class, status and the tool that staged them', () => {
    expect(failed({ proposalState: [{ at: 0, kind: 'build', class: 'B', status: 'executing', tool: 'propose_build' }, { at: 'last', kind: 'undo', status: 'completed' }] }, stack)).toEqual([]);
    expect(failed({ proposalState: [{ at: 0, status: 'completed' }, { at: 5 }] }, stack)).toEqual(['proposal 0 is completed', 'proposal 5 exists']);
  });

  it('matches each expected click with a distinct observed click', () => {
    expect(failed({ clicks: [{ status: 200, code: 'ok', result: 'executing' }, { status: 409, code: 'proposal_not_pending' }] }, stack)).toEqual([]);
    // One observed click cannot answer two expectations.
    expect(failed({ clicks: [{ status: 409, code: 'proposal_not_pending' }, { status: 409, code: 'proposal_not_pending' }] }, stack)).toHaveLength(1);
    expect(failed({ clicks: [{ status: 200, code: 'ok', result: 'completed' }] }, stack)).toHaveLength(1);
  });
});

describe('a case that expects the stack and ran without it', () => {
  it('fails once instead of passing by silence, and grades nothing for a plan-stage case', () => {
    expect(failed({ db: { counts: {} } }, undefined)).toEqual(['local-stack observation present']);
    expect(failed({ tools: { max: 3 } }, undefined)).toEqual([]);
  });
});
