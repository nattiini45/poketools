import { describe, expect, it } from 'vitest';
import { ltext } from '@/lib/studio-core/ltext';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { MAX_IDS_PER_LIST, MAX_CUSTOM_RULES_CHARS } from '../limits';
import { validateRulesetDocument } from '../validate';

const valid = () => structuredClone(newRulesetDocument('Spring OU', 'en', 'gen9ou')) as unknown as Record<string, unknown>;

function issuesOf(input: unknown): string[] {
  const result = validateRulesetDocument(input);
  return result.ok ? [] : result.issues.map((i) => `${i.code}@${i.path}`);
}

describe('validateRulesetDocument', () => {
  it('accepts a fresh document and returns an equal copy that shares no array with the input', () => {
    const input = valid();
    const result = validateRulesetDocument(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(input);
    expect(result.document.pokemon.ban).not.toBe((input.pokemon as { ban: string[] }).ban);
  });

  it('accepts a blank base, an allowlist and team constraints', () => {
    const doc = valid();
    doc.base = { kind: 'blank', gen: 7, doubles: true, universe: 'national' };
    doc.pokemon = { ban: [], unban: [], allow: ['pikachu', 'garchomp'] };
    doc.team_constraints = { tera_match: 'player_core', type_quotas: { source: 'fixed', fixed_types: ['Fire'], min_per_type: 1, allow_multi_count: false } };
    doc.min_shared_type_pct = 60;
    expect(issuesOf(doc)).toEqual([]);
  });

  it('refuses anything that is not a plain object', () => {
    for (const input of [null, undefined, 3, 'x', [], [valid()]]) expect(issuesOf(input)).toEqual(['not_object@']);
  });

  it('refuses unknown keys at every level instead of dropping them', () => {
    const doc = valid();
    doc.extra = 1;
    (doc.identity as Record<string, unknown>).extra = 1;
    (doc.pokemon as Record<string, unknown>).extra = 1;
    (doc.base as Record<string, unknown>).extra = 1;
    expect(issuesOf(doc).sort()).toEqual(['unknown_key@/base/extra', 'unknown_key@/extra', 'unknown_key@/identity/extra', 'unknown_key@/pokemon/extra']);
  });

  it('checks the schema version, the name, the base and the numbers', () => {
    const doc = valid();
    doc.schema_version = 2;
    doc.identity = { name: { base: 'fr' } };
    doc.base = { kind: 'blank', gen: 10, doubles: 'yes', universe: 'galaxy' };
    doc.min_shared_type_pct = 101;
    doc.custom_rules = 'x'.repeat(MAX_CUSTOM_RULES_CHARS + 1);
    expect(issuesOf(doc)).toEqual(
      expect.arrayContaining([
        'bad_schema_version@/schema_version',
        'bad_text@/identity/name/base',
        'bad_base@/base/gen',
        'bad_base@/base/doubles',
        'bad_base@/base/universe',
        'bad_percent@/min_shared_type_pct',
        'bad_custom_rules@/custom_rules',
      ]),
    );
  });

  it('wants a name in its base language', () => {
    const doc = valid();
    doc.identity = { name: { base: 'de', en: { v: 'Only English', s: 'human' } } };
    expect(issuesOf(doc)).toEqual(['bad_text@/identity/name/de']);
    doc.identity = { name: ltext('de', undefined, 'Frühling') };
    expect(issuesOf(doc)).toEqual([]);
  });

  it('accepts only lower-case alphanumeric ids and bounds every list', () => {
    const doc = valid();
    doc.pokemon = { ban: ['Garchomp', 'tapu-koko', ''], unban: [], allow: null };
    expect(issuesOf(doc)).toEqual(['bad_id@/pokemon/ban/0', 'bad_id@/pokemon/ban/1', 'bad_id@/pokemon/ban/2']);
    doc.pokemon = { ban: Array.from({ length: MAX_IDS_PER_LIST + 1 }, (_, i) => `id${i}`), unban: [], allow: null };
    expect(issuesOf(doc)).toEqual(['list_too_long@/pokemon/ban']);
    doc.pokemon = { ban: [], unban: [], allow: 'all' };
    expect(issuesOf(doc)).toEqual(['bad_list@/pokemon/allow']);
  });

  it('never reads inherited members (a prototype pollution attempt is an unknown key, not a value)', () => {
    const polluted = JSON.parse('{"__proto__": {"base": "en"}, "schema_version": 1}') as Record<string, unknown>;
    expect(issuesOf(polluted)).toContain('unknown_key@/__proto__');
    const doc = valid();
    const identity = doc.identity as Record<string, unknown>;
    Object.setPrototypeOf(identity, { name: ltext('en', 'Inherited') });
    delete identity.name;
    expect(issuesOf(doc)).toContain('bad_text@/identity/name');
  });

  it('refuses a string with a NUL character (Postgres jsonb cannot store it)', () => {
    const doc = valid();
    doc.custom_rules = 'a\u0000b';
    expect(issuesOf(doc)).toEqual(['bad_custom_rules@/custom_rules']);
  });

  it('refuses unknown team constraint members and out-of-range values', () => {
    const doc = valid();
    doc.team_constraints = { nope: true, tera_match: 'sometimes', type_quotas: { source: 'fixed', min_per_type: 9, allow_multi_count: true } };
    expect(issuesOf(doc).sort()).toEqual([
      'bad_team_constraints@/team_constraints/nope',
      'bad_team_constraints@/team_constraints/tera_match',
      'bad_team_constraints@/team_constraints/type_quotas',
    ]);
  });

  it('does not mutate its input', () => {
    const input = valid();
    const snapshot = JSON.stringify(input);
    validateRulesetDocument(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
