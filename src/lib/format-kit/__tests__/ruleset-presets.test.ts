/**
 * The rule presets of the format kit: the rule that picking a preset pre-fills a stage, and a preset ruleset inside
 * a document. The catalog view (listing, search, grouping) is tested in `src/lib/pkmn/__tests__/ruleset-preset-catalog.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { listRulesetPresets } from '@/lib/pkmn/ruleset-preset-catalog';
import { compile as compileServer } from '../compile';
import { compile as compileBrowser } from '../compile.browser';
import { CURRENT_ENV } from '../engine/env';
import { resolveLText } from '@/lib/studio-core/ltext';
import { PRESETS } from '../presets';
import {
  PRESET_PLAYERS_PER_MATCH,
  PRESET_VGC_BEST_OF,
  applyRulesetPreset,
  namedRulesetsOf,
  presetsOf,
  withRulesetPreset,
} from '../ruleset-presets';
import { validateFormatDefinition as validateBrowser } from '../validate.browser';
import { validateFormatDefinition as validateServer } from '../validate';
import type { FormatDefinition, Stage } from '../types';

const example = (id: string): FormatDefinition => {
  const found = PRESETS.find((p) => p.id === id);
  if (found === undefined) throw new Error(`no example ${id}`);
  return found.definition;
};
const errors = (def: FormatDefinition) => compileServer(def, CURRENT_ENV).diagnostics.filter((d) => d.severity === 'error');

describe('withRulesetPreset (one stage)', () => {
  const stage = (): Stage => structuredClone(example('classic-league').stages[0]);

  it('sets the ruleset, the doubles flag and two players, and leaves the series alone', () => {
    const before = stage();
    const next = withRulesetPreset(before, 'gen9doublesou');
    expect(next.ruleset).toEqual({ kind: 'preset', preset: 'gen9doublesou' });
    expect(next.doubles).toBe(true);
    expect(next.players_per_match).toBe(PRESET_PLAYERS_PER_MATCH);
    expect(next.series).toBe(before.series);
    expect(before.ruleset).toEqual({ kind: 'season_default' });
  });

  it('also clears the doubles flag when the preset is a singles preset, and takes a draft preset', () => {
    const doubles = { ...stage(), doubles: true };
    expect(withRulesetPreset(doubles, 'gen9ou').doubles).toBe(false);
    expect(withRulesetPreset(stage(), 'gen9doublesdraft')).toMatchObject({ ruleset: { kind: 'preset', preset: 'gen9doublesdraft' }, doubles: true });
  });

  it('returns the very same object when the stage already has the settings, and for an unknown id', () => {
    const picked = withRulesetPreset(stage(), 'gen9vgc');
    expect(withRulesetPreset(picked, 'gen9vgc')).toBe(picked);
    const before = stage();
    expect(withRulesetPreset(before, 'gen99xx')).toBe(before);
  });
});

describe('applyRulesetPreset', () => {
  it.each(PRESETS.map((p) => [p.id, p.definition] as const))('pre-picks every stage of the %s example', (_id, definition) => {
    const snapshot = structuredClone(definition);
    const result = applyRulesetPreset(definition, 'gen9ou');
    expect(definition).toEqual(snapshot);
    expect(result.stages).toHaveLength(definition.stages.length);
    result.stages.forEach((stage, i) => {
      expect(stage.ruleset).toEqual({ kind: 'preset', preset: 'gen9ou' });
      expect(stage.doubles).toBe(false);
      expect(stage.players_per_match).toBe(2);
      // Not VGC: the structure keeps its series length and its exceptions.
      expect(stage.series).toEqual(definition.stages[i].series);
      // Nothing else of the structure moves.
      expect({ ...stage, ruleset: null, doubles: null, players_per_match: null }).toEqual({
        ...definition.stages[i],
        ruleset: null,
        doubles: null,
        players_per_match: null,
      });
    });
    expect(result.edges).toBe(definition.edges);
    expect(result.rules).toBe(definition.rules);
  });

  it('sets best of 3 on every stage for VGC and keeps the exceptions', () => {
    const base = example('classic-league');
    const result = applyRulesetPreset(base, 'gen9vgc');
    expect(result.stages.map((s) => s.series.best_of)).toEqual([PRESET_VGC_BEST_OF, PRESET_VGC_BEST_OF]);
    expect(result.stages.every((s) => s.doubles)).toBe(true);
    expect(result.stages[1].series.overrides).toEqual(base.stages[1].series.overrides);
    expect(base.stages[0].series.best_of).toBe(1);
  });

  it('keeps the structure series length for every other tier, doubles and drafts included', () => {
    expect(applyRulesetPreset(example('classic-league'), 'gen9doublesou').stages.map((s) => s.series.best_of)).toEqual([1, 3]);
    const draft = applyRulesetPreset(example('classic-league'), 'gen9doubles4draft');
    expect(draft.stages.map((s) => s.series.best_of)).toEqual([1, 3]);
    expect(draft.stages.every((s) => s.doubles)).toBe(true);
  });

  it('keeps the author name by default and appends the preset name to it, in every language, when asked to retitle', () => {
    const base = example('cup');
    expect(applyRulesetPreset(base, 'gen9ou').identity.name).toBe(base.identity.name);
    const retitled = applyRulesetPreset(base, 'gen9ou', { retitle: true });
    expect(resolveLText(retitled.identity.name, { viewer: 'en' })?.value).toBe(`${resolveLText(base.identity.name, { viewer: 'en' })?.value} (Gen 9 OU)`);
    expect(resolveLText(retitled.identity.name, { viewer: 'de' })?.value).toMatch(/ \(Gen 9 OU\)$/);
    expect(retitled.identity.summary).toBe(base.identity.summary);
    expect(base.identity.name.en?.v).not.toContain('Gen 9');
  });

  it('leaves the definition as it is for an id the catalog does not know', () => {
    const base = example('cup');
    expect(applyRulesetPreset(base, 'gen99xx', { retitle: true })).toBe(base);
  });

  it('gives a document that compiles without an error for every example and every preset', () => {
    for (const { id, definition } of PRESETS) {
      for (const preset of listRulesetPresets()) {
        const result = applyRulesetPreset(definition, preset.id, { retitle: true });
        expect(errors(result).map((d) => d.code), `${id} ${preset.id}`).toEqual([]);
      }
    }
  });
});

describe('presetsOf', () => {
  it('lists the distinct presets in stage order and ignores the other kinds', () => {
    const def = structuredClone(example('swiss-top-cut'));
    expect(presetsOf(def)).toEqual([]);
    def.stages[0].ruleset = { kind: 'preset', preset: 'gen9vgc' };
    expect(presetsOf(def)).toEqual(['gen9vgc']);
    def.stages[1].ruleset = { kind: 'preset', preset: 'gen9ou' };
    expect(presetsOf(def)).toEqual(['gen9vgc', 'gen9ou']);
    def.stages[1].ruleset = { kind: 'preset', preset: 'gen9vgc' };
    expect(presetsOf(def)).toEqual(['gen9vgc']);
  });
});

describe('namedRulesetsOf', () => {
  const A = '3f2b8c1e-5a47-4d09-9b6e-7c1d2a4e8f10';
  const B = '7c1d2a4e-8f10-4d09-9b6e-3f2b8c1e5a47';

  it('lists the distinct stored rulesets the stages name, in stage order, and ignores the other kinds', () => {
    const def = structuredClone(example('swiss-top-cut'));
    expect(namedRulesetsOf(def)).toEqual([]);
    def.stages[0].ruleset = { kind: 'ruleset', id: A };
    def.stages[1].ruleset = { kind: 'preset', preset: 'gen9ou' };
    expect(namedRulesetsOf(def)).toEqual([A]);
    def.stages[1].ruleset = { kind: 'ruleset', id: B };
    expect(namedRulesetsOf(def)).toEqual([A, B]);
    def.stages[1].ruleset = { kind: 'ruleset', id: A };
    expect(namedRulesetsOf(def)).toEqual([A]);
  });

  it('reads a stored spec of any shape without throwing', () => {
    const bad = (stages: unknown) => ({ stages }) as unknown as Pick<FormatDefinition, 'stages'>;
    expect(namedRulesetsOf(bad(undefined))).toEqual([]);
    expect(namedRulesetsOf(bad('x'))).toEqual([]);
    expect(namedRulesetsOf(bad([null, 5, {}, { ruleset: null }, { ruleset: { kind: 'ruleset' } }, { ruleset: { kind: 'ruleset', id: 7 } }]))).toEqual([]);
  });
});

describe('a rule preset in a document', () => {
  const withRuleset = (ruleset: unknown) => {
    const doc = structuredClone(example('cup')) as unknown as { stages: { ruleset: unknown }[] };
    doc.stages[0].ruleset = ruleset;
    return doc;
  };

  it('is accepted by both validators and compiles cleanly', () => {
    for (const preset of ['gen9ou', 'gen9natdexdraft']) {
      const doc = withRuleset({ kind: 'preset', preset });
      expect(validateServer(doc).ok).toBe(true);
      expect(validateBrowser(doc).ok).toBe(true);
      expect(compileServer(doc).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(compileBrowser(doc).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    }
  });

  it.each([
    ['no preset', { kind: 'preset' }],
    ['a preset that is not a key', { kind: 'preset', preset: 'Gen 9 OU' }],
    ['a preset that is not text', { kind: 'preset', preset: 9 }],
    ['an unknown member', { kind: 'preset', preset: 'gen9ou', id: 'x' }],
    ['the retired showdown kind', { kind: 'showdown', format: 'gen9ou' }],
  ])('is refused by both validators with %s', (_name, ruleset) => {
    const doc = withRuleset(ruleset);
    expect(validateServer(doc).ok).toBe(false);
    expect(validateBrowser(doc).ok).toBe(false);
  });

  it('keeps a preset the catalog does not know loadable and reports it as an error with a fix', () => {
    const doc = withRuleset({ kind: 'preset', preset: 'gen99xx' });
    expect(validateServer(doc).ok).toBe(true);
    const found = compileServer(doc).diagnostics.find((d) => d.code === 'ruleset_preset_unknown');
    expect(found).toMatchObject({ severity: 'error', json_pointer: '/stages/0/ruleset/preset', params: { stage: 'groups', preset: 'gen99xx' } });
    expect(found?.fixes.map((f) => f.id)).toEqual(['use_season_ruleset']);
    expect(compileBrowser(doc).diagnostics.find((d) => d.code === 'ruleset_preset_unknown')).toEqual(found);
  });
});
