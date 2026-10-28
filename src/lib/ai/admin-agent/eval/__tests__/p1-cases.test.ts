import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { buildToolSet, getToolDefinition } from '../../registry';
import { casesForStage, loadAllCases, loadAllRecordings, loadCases, loadP1Cases, loadP1Recordings, loadRecordings, selectCases, validateCases } from '../data';
import { caseSchema, EVAL_SEEDS, type EvalCase } from '../types';
import { buildWorld, resolvePlaceholders } from '../world';

/**
 * The P1 case set (plan 7.3: RS1, RS3, TN1, TN2, LG1, LG2, LG4, LG6, LG9, LG10, UN1; TN3 is the decline variant of TN2). The plan
 * stage's own set (`data.test.ts`) must not move: these files are separate, and a run with no `--cases` picks by stage and phase.
 */
const p1 = loadP1Cases();
const byId = (id: string): EvalCase => p1.find((c) => c.id === id)!;
const stageOf = (stage: EvalCase['stage']): string[] => p1.filter((c) => c.stage === stage).map((c) => c.id).sort();

describe('the P1 set', () => {
  it('holds the plan\'s cases at the stage the brief gives them', () => {
    expect(stageOf('exec')).toEqual(['LG10', 'LG9', 'UN1']);
    expect(stageOf('plan')).toEqual(['LG1', 'LG4']);
    expect(stageOf('e2e')).toEqual(['LG2', 'LG6', 'RS1', 'RS3', 'TN1', 'TN2', 'TN3']);
    for (const testCase of p1) {
      expect(testCase.phase, testCase.id).toBe(1);
      expect(testCase.id).toMatch(/^(RS|TN|LG|UN)\d{1,2}$/);
    }
  });

  it('leaves the phase 0 set exactly as it was', () => {
    expect(new Set(loadCases().map((c) => c.area))).toEqual(new Set(['RO', 'SF']));
    expect(new Set(Object.keys(loadRecordings()).map((id) => id.replace(/\d.*/, '')))).toEqual(new Set(['RO', 'SF']));
    expect(loadAllCases()).toHaveLength(loadCases().length + p1.length);
    expect(() => validateCases(loadAllCases(), loadAllRecordings())).not.toThrow();
  });

  it('has a recording for every plan and exec case, and none that is dead', () => {
    const recordings = loadP1Recordings();
    for (const testCase of p1.filter((c) => c.stage !== 'e2e')) expect(recordings[testCase.id], testCase.id).toBeDefined();
    for (const id of Object.keys(recordings)) expect(byId(id), id).toBeDefined();
    for (const [id, recording] of Object.entries(recordings)) expect(recording.turns.length, id).toBe(byId(id).turns.length);
    // The two live-only cases have none; an e2e case may go without.
    expect(Object.keys(recordings)).not.toContain('RS3');
    expect(Object.keys(recordings)).not.toContain('LG2');
    expect(() => validateCases([{ ...byId('TN1'), id: 'TN9' }], {})).not.toThrow();
    expect(() => validateCases([{ ...byId('LG9'), id: 'LG8' }], {})).toThrow(/no recording/);
  });

  it('names only registered tools that the actor is offered at the case\'s phase', () => {
    for (const testCase of p1) {
      const set = buildToolSet({ role: testCase.actor === 'site_admin' ? 'site' : 'scoped', maxPhase: testCase.phase as 1 });
      const e = testCase.expect;
      for (const name of [...(e.tools?.required ?? []), ...(e.tools?.ordered ?? []), ...(e.tools?.forbidden ?? []), ...(e.proposals?.tools ?? [])]) {
        expect(getToolDefinition(name), `${testCase.id}: ${name}`).toBeDefined();
      }
      for (const name of e.tools?.required ?? []) expect(set.names, `${testCase.id}: ${name}`).toContain(name);
    }
    const recordings = loadP1Recordings();
    for (const testCase of p1) {
      const set = buildToolSet({ role: 'site', maxPhase: testCase.phase as 1 });
      for (const turn of recordings[testCase.id]?.turns ?? []) for (const step of turn) for (const call of step.calls ?? []) expect(set.names, `${testCase.id}: ${call.name}`).toContain(call.name);
    }
  });

  it('gives exec and e2e cases an expectation the stack can grade, and no gate-recall list that an approved action would break', () => {
    for (const testCase of p1.filter((c) => c.stage !== 'plan')) {
      const e = testCase.expect;
      expect(e.db ?? e.recorder ?? e.ledger ?? e.proposalState ?? e.clicks, testCase.id).toBeDefined();
      expect(testCase.irreversible, testCase.id).toBeUndefined();
    }
    for (const testCase of p1.filter((c) => c.stage === 'plan')) {
      expect(testCase.expect.db, testCase.id).toBeUndefined();
      expect(testCase.seed, testCase.id).toBeUndefined();
    }
  });

  it('puts the case id in every name a stack case creates, with the run tag, so a rerun finds only its own rows', () => {
    for (const testCase of p1.filter((c) => c.stage !== 'plan')) {
      const text = JSON.stringify(testCase.turns.map((t) => t.say));
      const created = [...text.matchAll(/(?:called|Name the ruleset|ruleset called) ([A-Z]{2}\d+ [A-Za-z0-9 ]+?) \{\{run:tag\}\}/g)];
      for (const match of created) expect(match[1].startsWith(testCase.id), `${testCase.id}: ${match[1]}`).toBe(true);
    }
  });

  it('only uses seeds and route faults the harness knows', () => {
    for (const testCase of p1) for (const seed of testCase.seed ?? []) expect(EVAL_SEEDS).toContain(seed);
    expect(byId('LG10').routeFaults).toEqual([{ op: 'phase_create', nth: 2, mode: 'late_commit_500' }]);
    expect(byId('LG10').turns[0].after).toEqual([{ do: 'release_fault' }, { do: 'resume' }]);
    expect(caseSchema.safeParse({ ...byId('LG10'), routeFaults: [{ op: 'phase_create', nth: 0, mode: 'late_commit_500' }] }).success).toBe(false);
    expect(caseSchema.safeParse({ ...byId('LG10'), turns: [{ say: 'x', after: [{ do: 'drop_table' }] }] }).success).toBe(false);
  });

  it('resolves every placeholder of every case once the run filled in its entities', () => {
    for (const testCase of p1) {
      const world = buildWorld(testCase.fixture, testCase.actor);
      world.dynamic = {
        proposalLast: '11111111-1111-4111-8111-111111111111',
        runTag: 'ab12',
        ledger: { league_create: '22222222-2222-4222-8222-222222222222', ruleset_create_draft: '33333333-3333-4333-8333-333333333333' },
        computed: { 'preset_pokemon.gen9ou+kingambit': {}, 'preset_pokemon.gen9ou+gliscor': {} },
        seeded: Object.fromEntries(
          EVAL_SEEDS.map((kind) => [kind, { id: '44444444-4444-4444-8444-444444444444', name: `${testCase.id} ${kind}`, phaseIds: ['55555555-5555-4555-8555-555555555555'], rulesetDefinitionId: '66666666-6666-4666-8666-666666666666', rulesetVersionId: '77777777-7777-4777-8777-777777777777', rulesetName: 'r' }]),
        ),
      };
      expect(() => resolvePlaceholders(world, { turns: testCase.turns, expect: testCase.expect, recording: loadP1Recordings()[testCase.id] }), testCase.id).not.toThrow();
    }
  });
});

describe('selecting by stage and phase', () => {
  const all = loadAllCases();

  it('keeps the default plan run at the phase 0 suite, and adds the P1 plan cases from phase 1', () => {
    expect(casesForStage(all, 'plan', 0).map((c) => c.id)).toEqual(loadCases().map((c) => c.id));
    expect(casesForStage(all, 'plan', 1).map((c) => c.id)).toEqual([...loadCases().map((c) => c.id), 'LG1', 'LG4']);
  });

  it('leaves a blocked case out of a run with no --cases, and runs it when it is named', () => {
    const blocked = p1.filter((c) => c.blockedBy !== undefined).map((c) => c.id).sort();
    expect(blocked).toEqual(['LG6', 'TN2', 'TN3']);
    for (const id of blocked) expect(byId(id).blockedBy, id).toMatch(/startup_checklist/);
    expect(casesForStage(all, 'e2e', 1).map((c) => c.id).sort()).toEqual(['LG2', 'RS1', 'RS3', 'TN1']);
    expect(casesForStage(all, 'exec', 1).map((c) => c.id).sort()).toEqual(['LG10', 'LG9', 'UN1']);
    expect(selectCases(all, ['TN2']).map((c) => c.id)).toEqual(['TN2']);
    expect(selectCases(all, ['LG']).map((c) => c.id).sort()).toEqual(['LG1', 'LG10', 'LG2', 'LG4', 'LG6', 'LG9']);
  });
});
