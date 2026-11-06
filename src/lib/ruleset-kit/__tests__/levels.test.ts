import { describe, expect, it } from 'vitest';
import { compileRuleset } from '../compile';
import { computeEffective, diffResolved } from '../effective';
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

// A document stored before `levels` existed (no such key) and the hashes it was published with.
const PRE_LEVELS_DOCUMENT = {"schema_version":1,"identity":{"name":{"base":"en","en":{"v":"Stable","s":"human"}}},"base":{"kind":"blank","gen":9,"doubles":false,"universe":"standard"},"clauses":{"add":[],"remove":[]},"pokemon":{"ban":[],"unban":[],"allow":null},"moves":{"ban":[],"unban":[],"allow":null},"items":{"ban":[],"unban":[],"allow":null},"abilities":{"ban":[],"unban":[],"allow":null},"min_shared_type_pct":0,"team_constraints":null,"custom_rules":""};
const PRE_LEVELS_CONTENT_HASH = '42e17e5a451cf69ee3cbc0df7774a985864baac54ed28dcf005ed2cb42e59cce';
const PRE_LEVELS_RESOLVED_HASH = '3909acf34364f051f30988a94e853b65f507c2dfc104c41bcc9a7747a00ee3e8';

describe('hashes of rulesets without level rules', () => {
  it('hash a pre-levels stored document exactly as before the field existed', () => {
    const result = compileRuleset(PRE_LEVELS_DOCUMENT, { preset: null });
    expect(result.document?.levels).toBeNull();
    expect(result.content_hash).toBe(PRE_LEVELS_CONTENT_HASH);
    expect(result.resolved_hash).toBe(PRE_LEVELS_RESOLVED_HASH);
  });

  it('hash level rules into both hashes once they are set', () => {
    const result = compileRuleset({ ...PRE_LEVELS_DOCUMENT, levels }, { preset: null });
    expect(result.content_hash).not.toBe(PRE_LEVELS_CONTENT_HASH);
    expect(result.resolved_hash).not.toBe(PRE_LEVELS_RESOLVED_HASH);
  });

  it('diff a frozen rule set that predates levels (key absent) against one with null levels as unchanged', () => {
    const resolved = compileRuleset(PRE_LEVELS_DOCUMENT, { preset: null }).resolved!;
    const { levels: _levels, ...old } = resolved;
    expect(diffResolved(old as typeof resolved, resolved).otherChanged).toBe(false);
  });
});
