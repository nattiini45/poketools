import { describe, expect, it } from 'vitest';
import { compileRuleset } from '../compile';
import { computeEffective } from '../effective';
import { readResolvedRules } from '../resolved';
import { validateRulesetDocument } from '../validate';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';

const levels = { policy: 'max' as const, default: 100, entries: [{ id: 'dialga', level: 90, status: 'approved' as const }] };

describe('ruleset level documents', () => {
  it('reads older documents without levels and normalizes new ones without sharing arrays', () => {
    const doc = newRulesetDocument('Levels', 'en');
    const { levels: _drop, ...old } = doc;
    expect(validateRulesetDocument(old)).toMatchObject({ ok: true, document: { levels: null } });
    const parsed = validateRulesetDocument({ ...doc, levels });
    expect(parsed).toMatchObject({ ok: true, document: { levels } });
    if (parsed.ok) expect(parsed.document.levels?.entries).not.toBe(levels.entries);
  });

  it.each([
    [{ policy: 'sometimes', default: 100, entries: [] }, '/levels/policy'],
    [{ policy: 'max', default: 0, entries: [] }, '/levels/default'],
    [{ policy: 'exact', default: 100, entries: [{ id: 'Dialga!', level: 90, status: 'approved' }] }, '/levels/entries/0'],
    [{ policy: 'max', default: 100, entries: [{ id: 'dialga', level: 90, status: 'experimental', extra: true }] }, '/levels/entries/0/extra'],
  ])('rejects malformed level rules', (value, path) => {
    const parsed = validateRulesetDocument({ ...newRulesetDocument('Levels', 'en'), levels: value });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues).toContainEqual({ code: 'bad_levels', path });
  });

  it('checks duplicate and unknown species and preserves levels in the frozen rules', () => {
    const doc = { ...newRulesetDocument('Levels', 'en'), levels: { ...levels, entries: [...levels.entries, ...levels.entries] } };
    const result = compileRuleset(doc, { preset: null, known: { pokemon: new Set(['dialga']) } });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'duplicate_entry', path: '/levels/entries/1/id' }));
    const clean = compileRuleset({ ...doc, levels }, { preset: null, known: { pokemon: new Set(['dialga']) } });
    expect(clean.ok).toBe(true);
    expect(clean.resolved?.levels).toEqual(levels);
    expect(readResolvedRules(clean.resolved).levels).toEqual(levels);
    expect(computeEffective({ ...doc, levels }, null).levels).toEqual(levels);
  });
});
