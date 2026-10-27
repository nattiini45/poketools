/**
 * The diagnostic sentences, the list-edit rules and the compact list editor in static markup, in both languages: every
 * diagnostic code has a sentence with its placeholders filled, and the chips of the list editor. The summary column that
 * uses them is `SummaryPanel.test.tsx` (a DOM).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { expectLabelledControls } from '@/test/markup';
import { createTranslator } from '@/i18n/core';
import { rulesetStudioDiagnosticsMessages } from '@/i18n/messages/ruleset-studio/diagnostics';
import type { CatalogIndex } from '@/lib/pkmn/catalog-index';
import { RULESET_DIAGNOSTIC_SEVERITY, type RulesetDiagnostic } from '@/lib/ruleset-kit/compile';
import { clearCatalogCache, fetchEntryIndex } from '@/lib/ruleset-studio/editor/catalog-client';
import { SPECIES_ROWS } from '@/lib/ruleset-studio/__tests__/editor/picker/fixtures';
import { applyListAction } from '@/lib/ruleset-studio/editor/picker/list-edit';

import EntryListEditor from '../EntryListEditor';
import { diagnosticText, fixKey } from '../summary/diagnostic-text';

const response = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }));

// The chips read their names from the entry index; seed it so no request is made.
beforeEach(async () => {
  clearCatalogCache();
  const index: CatalogIndex<'species'> = { v: 1, kind: 'species', gen: 9, scope: 'standard', preset: null, rows: SPECIES_ROWS };
  await fetchEntryIndex({ kind: 'species', gen: 9, scope: 'standard' }, { fetch: () => response(index) });
});

describe('diagnostic sentences', () => {
  const nameOf = (_category: string, id: string) => id.toUpperCase();
  const base: Record<string, RulesetDiagnostic['params']> = {
    invalid_structure: { issue: 'bad_id' },
    preset_unknown: { preset: 'gen9zz' },
    entry_in_ban_and_unban: { id: 'garchomp', category: 'pokemon' },
    allowlist_with_bans: { category: 'items' },
    allowlist_empty: { category: 'abilities' },
    duplicate_entry: { id: 'spore', category: 'moves' },
    unknown_clause: { id: 'notaclause' },
    clause_in_add_and_remove: { id: 'ohkoclause' },
    unknown_entry: { id: 'nosuchmon', category: 'pokemon' },
    ban_redundant: { id: 'koraidon', category: 'pokemon' },
    unban_not_banned: { id: 'pikachu', category: 'pokemon' },
    clause_informational: { id: 'ohkoclause' },
  };

  it.each(['en', 'de'] as const)('every diagnostic code has a sentence with every placeholder filled (%s)', (locale) => {
    const t = createTranslator(rulesetStudioDiagnosticsMessages, locale);
    for (const code of Object.keys(RULESET_DIAGNOSTIC_SEVERITY) as (keyof typeof RULESET_DIAGNOSTIC_SEVERITY)[]) {
      const text = diagnosticText({ code, severity: RULESET_DIAGNOSTIC_SEVERITY[code], path: '/x', params: base[code] }, t, nameOf);
      expect(text, code).not.toBe('');
      expect(text, code).not.toMatch(/\{|\}/);
    }
  });

  it('the two languages say different things and the entry name is used, not the id', () => {
    const en = createTranslator(rulesetStudioDiagnosticsMessages, 'en');
    const de = createTranslator(rulesetStudioDiagnosticsMessages, 'de');
    const d: RulesetDiagnostic = { code: 'duplicate_entry', severity: 'error', path: '/moves/ban/1', params: base.duplicate_entry };
    expect(diagnosticText(d, en, nameOf)).toBe('SPORE is listed twice in moves.');
    expect(diagnosticText(d, de, nameOf)).toBe('SPORE steht in Attacken doppelt.');
    const clause: RulesetDiagnostic = { code: 'unknown_clause', severity: 'error', path: '/clauses/add/0', params: { id: 'ohkoclause' } };
    expect(diagnosticText(clause, en, nameOf)).toBe('The clause OHKO Clause is not known.');
  });

  it('every structure problem has a name in both languages', () => {
    for (const locale of ['en', 'de'] as const) {
      const t = createTranslator(rulesetStudioDiagnosticsMessages, locale);
      for (const issue of ['not_object', 'unknown_key', 'bad_schema_version', 'bad_text', 'bad_based_on', 'bad_base', 'bad_list', 'list_too_long', 'bad_id', 'bad_percent', 'bad_team_constraints', 'bad_custom_rules']) {
        expect(t.has(`structure.${issue}`), `${locale} ${issue}`).toBe(true);
      }
    }
  });

  it('labels each fix by what it does', () => {
    expect(fixKey('allowlist_with_bans')).toBe('clear');
    expect(fixKey('preset_unknown')).toBe('blank');
    expect(fixKey('duplicate_entry')).toBe('remove');
    expect(fixKey('unban_not_banned')).toBe('remove');
  });
});

describe('list-edit', () => {
  it('adds on ban and allow, removes on unban and reset, flips on toggle, keeps the list sorted and unique', () => {
    expect(applyListAction(['b'], 'ban', ['c', 'a', 'a'])).toEqual(['a', 'b', 'c']);
    expect(applyListAction(['a', 'b'], 'unban', ['a'])).toEqual(['b']);
    expect(applyListAction(['a', 'b'], 'reset', ['b'])).toEqual(['a']);
    expect(applyListAction(['a'], 'toggle', ['a', 'z'])).toEqual(['z']);
    expect(applyListAction(['a'], 'allow', ['b'])).toEqual(['a', 'b']);
  });

  it('returns the same list when nothing changed and ignores ids that cannot be stored', () => {
    const list = ['a', 'b'];
    expect(applyListAction(list, 'ban', ['a'])).toBe(list);
    expect(applyListAction(list, 'unban', ['zz'])).toBe(list);
    expect(applyListAction(list, 'ban', ['', 'Not An Id', 'x'.repeat(65)])).toBe(list);
  });
});

describe('EntryListEditor', () => {
  const editor = (value: string[], locale: 'en' | 'de' = 'en') =>
    renderWithI18n(<EntryListEditor category="pokemon" label="Banned Pokémon" value={value} onChange={() => undefined} gen={9} scope="standard" />, { locale });

  it('shows each listed entry as a chip by name, in the viewer’s data language, with a remove button', () => {
    const html = editor(['charizard', 'garchomp']);
    expect(html).toContain('Charizard');
    expect(html).toContain('aria-label="Remove Garchomp"');
    expect(html).toContain('(2 entries)');
    expect(editor(['charizard'], 'de')).toContain('Glurak');
    expectLabelledControls(html);
  });

  it('an id the catalog does not know stays in the list as an unknown entry', () => {
    const html = editor(['nosuchmon']);
    expect(html).toContain('nosuchmon');
    expect(html).toContain('not in the entry list');
    expect(html).toContain('border-dashed');
  });

  it('says so when empty, cuts a long list at the chip limit and offers the picker', () => {
    expect(editor([])).toContain('Nothing listed yet.');
    const many = Array.from({ length: 20 }, (_, i) => `mon${String(i).padStart(2, '0')}`);
    const html = editor(many);
    expect(html).toContain('and 8 more');
    expect(html).toContain('Edit list…');
  });
});
