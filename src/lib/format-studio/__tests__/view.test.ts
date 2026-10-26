import { describe, expect, it } from 'vitest';
import { CURRENT_ENV, classicLeague, compile, computeCoverage, cup } from '@/lib/format-kit';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { legacyCompileEnv, toFormatView } from '../view';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('toFormatView', () => {
  it('copies a valid compile result into plain data', () => {
    const result = compile(classicLeague, legacyCompileEnv(8));
    const view = toFormatView(result);
    expect(view.ok).toBe(true);
    expect(view.hash).toBe(result.hash);
    expect(view.definition).toEqual(result.definition);
    expect(view.diagnostics).toEqual(result.diagnostics);
    expect(view.plan).toEqual(result.plan);
    expect(view.order).toEqual(['league', 'playoffs']);
    expect(view.capabilities).toEqual(result.capabilities);
    expect(view.coverage).toEqual(computeCoverage(classicLeague));
    expect(view.rulesets).toEqual([]);
    // The compile result is frozen and cached; the view must not share objects with it.
    expect(Object.isFrozen(result.definition)).toBe(true);
    expect(Object.isFrozen(view.definition)).toBe(false);
    expect(view.definition).not.toBe(result.definition);
    expect(Object.isFrozen(view.diagnostics)).toBe(false);
  });

  it('has no graph and no locale', () => {
    const view = toFormatView(compile(cup, CURRENT_ENV));
    expect(Object.keys(view).sort()).toEqual(
      ['capabilities', 'coverage', 'definition', 'diagnostics', 'hash', 'ok', 'order', 'plan', 'rulesets'].sort(),
    );
  });

  it('keeps the diagnostics of an invalid document and nothing else', () => {
    const view = toFormatView(compile({ schema_version: 1 }, CURRENT_ENV));
    expect(view.ok).toBe(false);
    expect(view.hash).toBeNull();
    expect(view.definition).toBeNull();
    expect(view.coverage).toBeNull();
    expect(view.plan).toBeNull();
    expect(view.capabilities).toBeNull();
    expect(view.order).toEqual([]);
    expect(view.diagnostics.length).toBeGreaterThan(0);
    expect(view.diagnostics.every((d) => d.severity === 'error')).toBe(true);
  });

  it('appends the stages a cyclic graph leaves out', () => {
    const def: FormatDefinition = clone(classicLeague);
    def.edges.push({ key: 'back', from: 'playoffs', to: 'league', select: [{ kind: 'top_n', n: 2 }], seeding: 'rank', gate: 'admin_confirm' });
    const result = compile(def, CURRENT_ENV);
    expect(result.diagnostics.some((d) => d.code === 'stage_cycle')).toBe(true);
    expect(result.graph?.order.length).toBeLessThan(2);
    const view = toFormatView(result);
    expect(view.order).toEqual(['league', 'playoffs']);
    expect(view.ok).toBe(false);
  });

  it('lists the graph order first and each stage once', () => {
    const def: FormatDefinition = clone(classicLeague);
    // Declare the playoffs first: the graph order still puts the feeding stage first.
    def.stages.reverse();
    const view = toFormatView(compile(def, CURRENT_ENV));
    expect(view.order).toEqual(['league', 'playoffs']);
    expect(new Set(view.order).size).toBe(view.order.length);
  });

  it('survives a JSON round trip unchanged', () => {
    for (const definition of [classicLeague, cup]) {
      const view = toFormatView(compile(definition, legacyCompileEnv(12)), { rulesets: [{ id: 'r1', name: 'Rules' }] });
      expect(JSON.parse(JSON.stringify(view))).toStrictEqual(view);
    }
    const invalid = toFormatView(compile(null, CURRENT_ENV));
    expect(JSON.parse(JSON.stringify(invalid))).toStrictEqual(invalid);
  });

  it('copies the ruleset names it is given', () => {
    const rulesets = [{ id: 'r1', name: 'Rules' }];
    const view = toFormatView(compile(cup, CURRENT_ENV), { rulesets });
    expect(view.rulesets).toEqual(rulesets);
    expect(view.rulesets[0]).not.toBe(rulesets[0]);
  });
});

describe('legacyCompileEnv', () => {
  it('sets the roster size only from two participants on', () => {
    expect(legacyCompileEnv(0)).toEqual(CURRENT_ENV);
    expect('rosterSize' in legacyCompileEnv(0)).toBe(false);
    expect('rosterSize' in legacyCompileEnv(1)).toBe(false);
    expect(legacyCompileEnv(2)).toEqual({ ...CURRENT_ENV, rosterSize: 2 });
    expect(legacyCompileEnv(64).rosterSize).toBe(64);
  });

  it('ignores a count that is not a whole number', () => {
    for (const value of [-4, Number.NaN, 2.5, Number.POSITIVE_INFINITY]) {
      expect('rosterSize' in legacyCompileEnv(value), String(value)).toBe(false);
    }
  });

  it('does not change the shared environment', () => {
    legacyCompileEnv(10);
    expect('rosterSize' in CURRENT_ENV).toBe(false);
  });
});
