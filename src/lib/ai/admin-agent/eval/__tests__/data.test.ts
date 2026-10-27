import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { buildToolSet, getToolDefinition } from '../../registry';
import { loadCases, loadRecordings, selectCases, validateCases } from '../data';
import { buildWorld, resolvePlaceholders } from '../world';
import { caseSchema, recordingSchema, type EvalCase } from '../types';

/**
 * The case files and recordings are data (plan 7.3): this checks their shape and what they refer to, so a typo in a tool
 * name or a case without a recording fails here, not in a run. The case counts are the plan's: RO and SF, English with
 * German twins for about a quarter.
 */
const cases = loadCases();
const recordings = loadRecordings();

const names = (testCase: EvalCase): string[] => {
  const e = testCase.expect;
  return [...(e.tools?.required ?? []), ...(e.tools?.ordered ?? []), ...(e.tools?.forbidden ?? []), ...(e.proposals?.tools ?? [])];
};

describe('case files', () => {
  it('holds read-only and safety cases of phase 0 for the plan stage', () => {
    expect(new Set(cases.map((c) => c.area))).toEqual(new Set(['RO', 'SF']));
    expect(new Set(cases.map((c) => c.phase))).toEqual(new Set([0]));
    expect(new Set(cases.map((c) => c.stage))).toEqual(new Set(['plan']));
    expect(cases.filter((c) => c.area === 'RO').length).toBeGreaterThanOrEqual(14);
    expect(cases.filter((c) => c.area === 'SF').length).toBeGreaterThanOrEqual(10);
  });

  it('has unique ids that follow the id pattern', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(RO|SF)\d{1,3}(-DE)?$/);
  });

  it('gives about a quarter of the English cases a German twin', () => {
    const english = cases.filter((c) => c.locale === 'en');
    const twins = cases.filter((c) => c.twinOf !== undefined);
    expect(twins.length / english.length).toBeGreaterThan(0.2);
    expect(twins.length / english.length).toBeLessThan(0.3);
    for (const twin of twins) {
      expect(twin.id).toBe(`${twin.twinOf}-DE`);
      expect(english.some((c) => c.id === twin.twinOf)).toBe(true);
    }
  });

  it('names only registered tools, and none of them is a tool of a later phase that the case could not reach', () => {
    for (const testCase of cases) {
      for (const name of names(testCase)) expect(getToolDefinition(name), `${testCase.id}: ${name}`).toBeDefined();
    }
  });

  it('asks only for tools the actor is offered when it requires a call', () => {
    for (const testCase of cases) {
      const set = buildToolSet({ role: testCase.actor === 'site_admin' ? 'site' : 'scoped', maxPhase: testCase.phase as 0 });
      for (const name of testCase.expect.tools?.required ?? []) expect(set.names, `${testCase.id}: ${name}`).toContain(name);
    }
  });

  it('keeps the German twins equal in everything but the words', () => {
    for (const twin of cases.filter((c) => c.twinOf !== undefined)) {
      const original = cases.find((c) => c.id === twin.twinOf)!;
      const strip = (c: EvalCase) => JSON.stringify({ ...c.expect, answer: undefined });
      expect(strip(twin), twin.id).toBe(strip(original));
      expect(twin.expect.answer?.language).toBe('de');
      expect(original.expect.answer?.language).toBe('en');
      expect(twin.irreversible).toEqual(original.irreversible);
      expect(twin.faults).toEqual(original.faults);
    }
  });

  it('keeps the clock on a Monday for every case (the deliberate edge case of "next Monday")', () => {
    for (const testCase of cases) expect(new Date(testCase.clock).getUTCDay(), testCase.id).toBe(1);
  });

  it('puts the gate-recall population in place: irreversible and outward requests', () => {
    const population = cases.flatMap((c) => c.irreversible ?? []);
    expect(population.length).toBeGreaterThanOrEqual(8);
    expect(new Set(population)).toContain('start_phase');
    expect(new Set(population)).toContain('league_trash');
    expect(new Set(population)).toContain('discord_post');
  });

  it('resolves every placeholder in every case and recording against the world', () => {
    for (const testCase of cases) {
      const world = buildWorld(testCase.fixture, testCase.actor);
      expect(() => resolvePlaceholders(world, testCase), testCase.id).not.toThrow();
      expect(() => resolvePlaceholders(world, recordings[testCase.id]), testCase.id).not.toThrow();
    }
  });

  it('contains no deployment fact, private pack name or real name (public-repo hygiene)', () => {
    const text = JSON.stringify([cases, recordings]);
    for (const banned of [/evoliga/i, /vercel/i, /\.supabase\.co/i, /format-packs\/private/i, /\.internal\//i, /poketools\.(app|dev|com)/i]) {
      expect(text, String(banned)).not.toMatch(banned);
    }
  });
});

describe('recordings', () => {
  it('parse with their schema and match their case turn for turn', () => {
    for (const [id, recording] of Object.entries(recordings)) {
      expect(() => recordingSchema.parse(recording), id).not.toThrow();
      expect(recording.turns.length).toBe(cases.find((c) => c.id === id)!.turns.length);
    }
    expect(() => validateCases(cases, recordings)).not.toThrow();
  });

  it('call only tools of the tool set the actor is offered, or deliberately one that is not (none do)', () => {
    for (const testCase of cases) {
      const set = buildToolSet({ role: testCase.actor === 'site_admin' ? 'site' : 'scoped', maxPhase: testCase.phase as 0 });
      for (const turn of recordings[testCase.id].turns) {
        for (const step of turn) for (const call of step.calls ?? []) expect(set.names, `${testCase.id}: ${call.name}`).toContain(call.name);
      }
    }
  });

  it('end every turn with a text step when the case expects an answer', () => {
    for (const testCase of cases) {
      if (!testCase.expect.answer) continue;
      const last = recordings[testCase.id].turns.at(-1)!.at(-1)!;
      expect(last.text, testCase.id).toBeTruthy();
      expect(last.calls, testCase.id).toBeUndefined();
    }
  });
});

describe('validateCases', () => {
  const base = cases.find((c) => c.id === 'RO1')!;
  const twin = cases.find((c) => c.id === 'RO1-DE')!;

  it('rejects a duplicate id, an unknown twin, a twin of another shape and a missing or extra recording', () => {
    expect(() => validateCases([base, base], recordings)).toThrow(/duplicate/);
    expect(() => validateCases([base, { ...twin, twinOf: 'RO99' }], recordings)).toThrow(/unknown case/);
    expect(() => validateCases([base, { ...twin, actor: 'league_admin' }], recordings)).toThrow(/differs from its original in actor/);
    expect(() => validateCases([{ ...base, id: 'RO98' }], recordings)).toThrow(/no recording/);
    expect(() => validateCases([base], { ...recordings, RO99: recordings.RO1 })).toThrow(/has no case/);
    expect(() => validateCases([{ ...base, turns: [...base.turns, base.turns[0]] }], recordings)).toThrow(/turns/);
  });

  it('rejects a case file with an unknown key or an ambiguous plan check', () => {
    expect(() => caseSchema.parse({ ...base, surprise: true })).toThrow();
    expect(() => caseSchema.parse({ ...base, expect: { plan: { checks: [{ path: '/a', equals: 1, exists: true }] } } })).toThrow();
    expect(() => caseSchema.parse({ ...base, expect: { plan: { checks: [{ path: 'a', equals: 1 }] } } })).toThrow();
  });
});

describe('selectCases', () => {
  it('selects by id, by id with its twin, and by area; an unknown selector is an error', () => {
    expect(selectCases(cases, ['RO1']).map((c) => c.id)).toEqual(['RO1', 'RO1-DE']);
    expect(selectCases(cases, ['SF']).every((c) => c.area === 'SF')).toBe(true);
    expect(selectCases(cases, ['RO1-DE']).map((c) => c.id)).toEqual(['RO1-DE']);
    expect(selectCases(cases, [])).toHaveLength(cases.length);
    expect(() => selectCases(cases, ['XX9'])).toThrow(/no case matches/);
  });
});
