import { describe, expect, it } from 'vitest';
import { applyPatch, type JsonValue } from '@/lib/studio-core/patch';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { compileRuleset, type CompileContext, type RulesetDiagnosticCode } from '../compile';
import type { RulesetDocument } from '../types';

const PRESET: PresetRules = {
  id: 'gen9ou',
  name: 'Gen 9 OU',
  gen: 9,
  mod: 'gen9',
  universe: 'standard',
  doubles: false,
  source: 'showdown',
  clauses: ['speciesclause', 'sleepclausemod'],
  pokemon: { mode: 'block', ids: ['koraidon'] },
  moves: { mode: 'block', ids: [] },
  items: { mode: 'block', ids: [] },
  abilities: { mode: 'block', ids: [] },
  facts: {} as PresetRules['facts'],
  combination_bans: [],
  catalog_version: 'test',
};
const CTX: CompileContext = { preset: PRESET };

function doc(patch: Partial<RulesetDocument> = {}): Record<string, unknown> {
  return { ...newRulesetDocument('Test', 'en', 'gen9ou'), ...patch } as unknown as Record<string, unknown>;
}

const codes = (input: unknown, ctx: CompileContext = CTX): RulesetDiagnosticCode[] =>
  compileRuleset(input, ctx).diagnostics.map((d) => d.code);

describe('compileRuleset', () => {
  it('compiles a clean document to resolved rules and two stable hashes', () => {
    const a = compileRuleset(doc(), CTX);
    const b = compileRuleset(doc(), CTX);
    expect(a.ok).toBe(true);
    expect(a.resolved?.pokemon.ids).toEqual(['koraidon']);
    expect(a.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.resolved_hash).toMatch(/^[0-9a-f]{64}$/);
    expect([a.content_hash, a.resolved_hash]).toEqual([b.content_hash, b.resolved_hash]);
    // The Sleep Clause Mod of the preset is a known clause the app does not enforce: one info, no error.
    expect(a.diagnostics.map((d) => [d.code, d.severity])).toEqual([['clause_informational', 'info']]);
  });

  it('the resolved hash changes with the catalog although the document does not', () => {
    const base = compileRuleset(doc(), CTX);
    const corrected = compileRuleset(doc(), { preset: { ...PRESET, pokemon: { mode: 'block', ids: ['koraidon', 'miraidon'] } } });
    expect(corrected.content_hash).toBe(base.content_hash);
    expect(corrected.resolved_hash).not.toBe(base.resolved_hash);
  });

  it('reports a structural problem once per issue and nothing else', () => {
    const result = compileRuleset({ ...doc(), min_shared_type_pct: 500 }, CTX);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([{ code: 'invalid_structure', severity: 'error', path: '/min_shared_type_pct', params: { issue: 'bad_percent' } }]);
    expect(result.document).toBeNull();
    expect(result.resolved).toBeNull();
  });

  it('refuses an unknown preset, with a fix that switches to a blank base', () => {
    const input = doc({ base: { kind: 'preset', preset: 'gen9nope' } });
    const result = compileRuleset(input, { preset: null });
    expect(result.diagnostics[0]).toMatchObject({ code: 'preset_unknown', severity: 'error', path: '/base/preset' });
    expect(result.ok).toBe(false);
    const fixed = applyPatch(input as unknown as JsonValue, result.diagnostics[0].fix ?? []);
    expect(fixed.ok).toBe(true);
    if (fixed.ok) expect(compileRuleset(fixed.value, { preset: null }).ok).toBe(true);
  });

  it('errors on an id in both ban and unban, duplicates, an unknown clause and an allowlist with bans', () => {
    const input = doc({
      pokemon: { ban: ['garchomp', 'garchomp'], unban: ['garchomp'], allow: null },
      clauses: { add: ['madeupclause'], remove: [] },
      moves: { ban: ['x'], unban: [], allow: ['a'] },
      abilities: { ban: [], unban: [], allow: [] },
    });
    expect(codes(input).sort()).toEqual(
      ['allowlist_empty', 'allowlist_with_bans', 'duplicate_entry', 'entry_in_ban_and_unban', 'entry_in_ban_and_unban', 'unban_not_banned', 'unknown_clause'].sort(),
    );
  });

  it('every fix removes its own diagnostic without adding an error', () => {
    const input = doc({
      pokemon: { ban: ['garchomp', 'azumarill', 'azumarill'], unban: ['garchomp'], allow: null },
      clauses: { add: ['madeupclause', 'itemclause'], remove: ['itemclause'] },
      moves: { ban: ['x'], unban: [], allow: ['a'] },
    });
    const first = compileRuleset(input, CTX);
    const fixable = first.diagnostics.filter((d) => d.severity === 'error' && d.fix !== undefined);
    expect(fixable.length).toBeGreaterThan(0);
    for (const diagnostic of fixable) {
      const patched = applyPatch(input as unknown as JsonValue, diagnostic.fix ?? []);
      expect(patched.ok, diagnostic.code).toBe(true);
      if (!patched.ok) continue;
      const after = compileRuleset(patched.value, CTX).diagnostics.filter((d) => d.severity === 'error');
      expect(after.some((d) => d.code === diagnostic.code && d.path === diagnostic.path), `${diagnostic.code} ${diagnostic.path}`).toBe(false);
      expect(after.length).toBeLessThanOrEqual(first.diagnostics.filter((d) => d.severity === 'error').length - 1);
    }
  });

  it('warns about a ban the base already has and an unban of something it does not ban', () => {
    const input = doc({ pokemon: { ban: ['koraidon'], unban: ['pikachu'], allow: null } });
    const result = compileRuleset(input, CTX);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.code).sort()).toEqual(['ban_redundant', 'unban_not_banned']);
  });

  it('flags unknown ids only when the id sets are supplied (server-authoritative)', () => {
    const input = doc({ pokemon: { ban: ['garchomp', 'garchmop'], unban: [], allow: null } });
    expect(codes(input)).not.toContain('unknown_entry');
    const known = { pokemon: new Set(['garchomp', 'koraidon']) };
    const warned = compileRuleset(input, { preset: PRESET, known }).diagnostics.filter((d) => d.code === 'unknown_entry');
    expect(warned).toEqual([expect.objectContaining({ severity: 'warning', path: '/pokemon/ban/1', params: { id: 'garchmop', category: 'pokemon' } })]);
  });

  it('an allowlist preset warns about an unban of an id already on its list, not of one it rules out', () => {
    const roster: PresetRules = { ...PRESET, pokemon: { mode: 'allow', ids: ['garchomp', 'pikachu'] } };
    const input = doc({ pokemon: { ban: [], unban: ['pikachu', 'koraidon'], allow: null } });
    const warned = compileRuleset(input, { preset: roster }).diagnostics.filter((d) => d.code === 'unban_not_banned');
    expect(warned.map((d) => d.path)).toEqual(['/pokemon/unban/0']);
  });

  it('a blank base warns about an unban of a move, an item or an ability (the base bans nothing)', () => {
    const input = doc({ base: { kind: 'blank', gen: 9, doubles: false, universe: 'standard' }, moves: { ban: [], unban: ['x'], allow: null } });
    expect(codes(input, { preset: null })).toContain('unban_not_banned');
  });
});
