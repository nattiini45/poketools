import { describe, expect, it } from 'vitest';
import { CURRENT_ENV, PRESETS, compile, deepFreeze, type FormatDefinition } from '@/lib/format-kit/client';
import { planStages } from '../../materialise';
import { previewAttach, type AttachPreview } from '../../editor/attach-preview';

const RULESET = '3f2b8c1e-5a47-4d09-9b6e-7c1d2a4e8f10';
const HASH = 'a'.repeat(64);

function spec(id: string): FormatDefinition {
  const found = PRESETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return structuredClone(found.definition);
}

function preview(source: unknown, over: Partial<Parameters<typeof previewAttach>[0]> = {}): AttachPreview {
  return previewAttach({ spec: source, seasonRulesetId: RULESET, seasonLanguage: 'en', specHash: HASH, ...over });
}

function okPreview(source: unknown, over: Partial<Parameters<typeof previewAttach>[0]> = {}) {
  const result = preview(source, over);
  if (!result.ok) throw new Error(`expected a preview, got ${result.firstError}`);
  return result;
}

describe('the presets', () => {
  it.each([
    ['classic-league', ['League phase', 'Playoffs'], ['round_robin', 'single_elim']],
    ['cup', ['Group stage', 'Knockout'], ['round_robin', 'single_elim']],
    ['swiss-top-cut', ['Swiss rounds', 'Top cut'], ['swiss', 'single_elim']],
  ] as const)('%s previews its stages in graph order', (id, names, brackets) => {
    const result = okPreview(spec(id));
    expect(result.stages.map((s) => s.order)).toEqual([1, 2]);
    expect(result.stages.map((s) => s.name)).toEqual(names);
    expect(result.stages.map((s) => s.bracketType)).toEqual(brackets);
    expect(result.leagueRulesetMissing).toBe(0);
  });

  it('names the stages in the language of the league', () => {
    expect(okPreview(spec('classic-league'), { seasonLanguage: 'de' }).stages.map((s) => s.name)).toEqual(['Ligaphase', 'Playoffs']);
    expect(okPreview(spec('swiss-top-cut'), { seasonLanguage: 'de' }).stages[1].name).toBe('Top-Cut');
  });

  it('carries the series length and the doubles flag', () => {
    const result = okPreview(spec('classic-league'));
    expect(result.stages.map((s) => s.bestOf)).toEqual([1, 3]);
    expect(result.stages.map((s) => s.doubles)).toEqual([false, false]);
    const doubles = spec('classic-league');
    doubles.stages[0].doubles = true;
    expect(okPreview(doubles).stages[0].doubles).toBe(true);
  });

  it('follows the graph order, not the order the stages are written in', () => {
    const reversed = spec('classic-league');
    reversed.stages = [reversed.stages[1], reversed.stages[0]];
    const result = okPreview(reversed);
    expect(result.stages.map((s) => s.key)).toEqual(['league', 'playoffs']);
    expect(result.stages.map((s) => s.order)).toEqual([1, 2]);
  });
});

describe('warnings', () => {
  it.each(PRESETS.map((p) => p.id))('equal what planStages reports for %s', (id) => {
    const source = spec(id);
    const compiled = compile(source, CURRENT_ENV);
    if (compiled.definition === null || compiled.graph === null || compiled.plan === null) throw new Error('does not compile');
    const planned = planStages({
      definition: compiled.definition,
      graphOrder: compiled.graph.order,
      plan: compiled.plan,
      seasonRulesetId: RULESET,
      seasonLanguage: 'en',
      specHash: HASH,
    });
    expect(okPreview(source).warnings).toEqual(planned.warnings);
  });

  it('names the parts the engine does not run yet', () => {
    const codes = okPreview(spec('classic-league')).warnings.map((w) => w.code);
    expect(codes).toContain('rr_legs_not_run');
    expect(okPreview(spec('swiss-top-cut')).warnings.map((w) => w.code)).toContain('third_place_not_run');
    expect(okPreview(spec('cup')).warnings.map((w) => w.code)).toContain('groups_not_created');
  });
});

describe('an invalid spec', () => {
  it('is not planned and names the first error', () => {
    const broken = spec('classic-league');
    broken.stages[0].series.best_of = 2;
    expect(preview(broken)).toEqual({ ok: false, reason: 'invalid', firstError: 'series_even_best_of' });
  });

  it('names a schema error for a document that is not a format', () => {
    const result = preview({ schema_version: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
    expect(result.firstError).toMatch(/^schema_/);
    expect(preview(null).ok).toBe(false);
  });

  it('never throws, whatever the league has', () => {
    expect(() => preview({}, { seasonRulesetId: null })).not.toThrow();
  });
});

describe('the league ruleset', () => {
  it('counts the stages that need it when the league has none', () => {
    const result = okPreview(spec('classic-league'), { seasonRulesetId: null });
    expect(result.leagueRulesetMissing).toBe(2);
    expect(result.stages.map((s) => s.ruleset)).toEqual(['league', 'league']);
  });

  it('is zero when the league has one', () => {
    expect(okPreview(spec('classic-league'), { seasonRulesetId: RULESET }).leagueRulesetMissing).toBe(0);
  });

  it('previews a spec with named rulesets without a league ruleset', () => {
    const named = spec('classic-league');
    named.stages = named.stages.map((s) => ({ ...s, ruleset: { kind: 'ruleset' as const, id: RULESET } }));
    const result = okPreview(named, { seasonRulesetId: null });
    expect(result.leagueRulesetMissing).toBe(0);
    expect(result.stages.map((s) => s.ruleset)).toEqual(['named', 'named']);
  });

  it('counts only the stages that fall back on the league ruleset', () => {
    const mixed = spec('classic-league');
    mixed.stages[1] = { ...mixed.stages[1], ruleset: { kind: 'ruleset', id: RULESET } };
    const result = okPreview(mixed, { seasonRulesetId: null });
    expect(result.leagueRulesetMissing).toBe(1);
    expect(result.stages.map((s) => s.ruleset)).toEqual(['league', 'named']);
  });

  it('never shows the stand-in id the planner needs', () => {
    expect(JSON.stringify(okPreview(spec('classic-league'), { seasonRulesetId: null }))).not.toContain('00000000-0000');
  });
});

describe('purity', () => {
  it('does not mutate a frozen spec', () => {
    const frozen = deepFreeze(spec('cup'));
    expect(() => preview(frozen)).not.toThrow();
    expect(okPreview(frozen).stages).toHaveLength(2);
  });
});
