/**
 * The live summary column, the diagnostic sentences and the compact list editor in static markup, in both languages: the
 * four tabs, the issue rows with their fixes, the change list with revert buttons, the rules text in English and German, and
 * the chips of the list editor. A small harness runs the real editor hook so the panel reads a real compile.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { expectLabelledControls, expectNoLeftovers, expectUniqueIds } from '@/test/markup';
import { createTranslator } from '@/i18n/core';
import { rulesetStudioDiagnosticsMessages } from '@/i18n/messages/ruleset-studio/diagnostics';
import type { CatalogIndex } from '@/lib/pkmn/catalog-index';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { RULESET_DIAGNOSTIC_SEVERITY, type RulesetDiagnostic } from '@/lib/ruleset-kit/compile';
import { banEntries, setClause } from '@/lib/ruleset-kit/ops';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { clearCatalogCache, fetchCatalogIndex } from '@/lib/ruleset-studio/editor/catalog-client';
import { SPECIES_ROWS } from '@/lib/ruleset-studio/__tests__/editor/picker/fixtures';
import { applyListAction } from '@/lib/ruleset-studio/editor/picker/list-edit';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import EntryListEditor from '../EntryListEditor';
import { useRulesetEditor } from '../editor/useRulesetEditor';
import SummaryPanel, { type SummaryTab } from '../summary/SummaryPanel';
import { diagnosticText, fixKey } from '../summary/diagnostic-text';

const PRESET: PresetRules = {
  id: 'gen9ou',
  name: 'Gen 9 OU',
  gen: 9,
  mod: 'gen9',
  universe: 'standard',
  doubles: false,
  source: 'showdown',
  clauses: ['speciesclause', 'sleepclausemod'],
  pokemon: { mode: 'block', ids: ['koraidon', 'miraidon'] },
  moves: { mode: 'block', ids: ['lastrespects'] },
  items: { mode: 'block', ids: [] },
  abilities: { mode: 'block', ids: ['moody'] },
  facts: { unmodelled: [] } as unknown as PresetRules['facts'],
  combination_bans: [],
  catalog_version: 'test',
};

const response = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }));

async function seed(): Promise<void> {
  const index: CatalogIndex<'species'> = { v: 1, kind: 'species', gen: 9, scope: 'standard', preset: null, rows: SPECIES_ROWS };
  await fetchCatalogIndex({ kind: 'species', gen: 9, scope: 'standard' }, { fetch: () => response(index) });
}

function Harness({ doc, tab, rulesLocale }: { doc: ReturnType<typeof newRulesetDocument>; tab: SummaryTab; rulesLocale?: 'en' | 'de' }) {
  const model = useRulesetEditor({ definitionId: 'r1', initialDoc: doc, initialRev: 1, initialPreset: PRESET });
  return <SummaryPanel model={model} initialTab={tab} initialRulesLocale={rulesLocale} onSelectSection={() => undefined} onApplyFix={() => undefined} />;
}

const edited = () => {
  let d = newRulesetDocument('Spring OU', 'en', 'gen9ou');
  d = banEntries(d, 'pokemon', ['garchomp'], PRESET.pokemon).doc;
  d = banEntries(d, 'moves', ['spore'], PRESET.moves).doc;
  return setClause(d, 'sleepclausemod', false, PRESET.clauses);
};

const broken = () => {
  const d = newRulesetDocument('Broken', 'en', 'gen9ou');
  return { ...d, pokemon: { ban: ['garchomp', 'garchomp'], unban: ['garchomp'], allow: null } };
};

beforeEach(async () => {
  clearCatalogCache();
  await seed();
});

describe('SummaryPanel', () => {
  it.each(['en', 'de'] as const)('has the four tabs as a tablist with the selected one controlling its panel (%s)', (locale) => {
    const html = renderWithI18n(<Harness doc={edited()} tab="summary" />, { locale });
    expect(html).toContain('role="tablist"');
    expect([...html.matchAll(/role="tab"/g)]).toHaveLength(4);
    expect(html).toContain('aria-selected="true"');
    expect(html).toMatch(/role="tabpanel"[^>]*aria-labelledby="[^"]*-tab-summary"/);
    expectUniqueIds(html);
    expectNoLeftovers(html);
    expectLabelledControls(html);
  });

  it('the summary tab compares with the preset and counts what is in effect', () => {
    const html = renderWithI18n(<Harness doc={edited()} tab="summary" />);
    expect(html).toContain('Compared with Gen 9 OU');
    expect(html).toContain('2 banned, 0 unbanned');
    expect(html).toContain('3 Pokémon banned');
    expect(html).toContain('2 moves banned');
    expect(html).toContain('2 from the preset');
    expect(html).toContain('1 clause');
  });

  it('says so when nothing differs from the base', () => {
    expect(renderWithI18n(<Harness doc={newRulesetDocument('Plain', 'en', 'gen9ou')} tab="summary" />)).toContain('No changes against the base yet.');
  });

  it('the changes tab lists every entry with a revert button named after it, and clause switches', () => {
    const html = renderWithI18n(<Harness doc={edited()} tab="changes" />);
    expect(html).toContain('Your changes');
    expect(html).toContain('aria-label="Revert garchomp"'.replace('garchomp', 'garchomp'));
    expect(html).toContain('Banned: ');
    expect(html).toContain('Clause removed: ');
    expect(html).toContain('Sleep Clause Mod');
  });

  it('the issues tab names each problem in words, with its severity, a way to the field and a one-click fix', () => {
    const html = renderWithI18n(<Harness doc={broken()} tab="issues" />);
    expect(html).toContain('is listed twice in Pokémon');
    expect(html).toContain('is both banned and unbanned in Pokémon');
    expect(html).toContain('Error');
    expect(html).toContain('Go to the field');
    expect(html).toContain('Fix: Remove the entry');
    expectNoLeftovers(html);
  });

  it('the issues tab of a clean ruleset says there is nothing to fix; informational clauses show as notes', () => {
    expect(renderWithI18n(<Harness doc={newRulesetDocument('Plain', 'en')} tab="issues" />)).toContain('No problems found.');
    const note = renderWithI18n(<Harness doc={newRulesetDocument('Plain', 'en', 'gen9ou')} tab="issues" />);
    expect(note).toContain('Note');
    expect(note).toContain('Sleep Clause Mod is shown on the rules page but the team validator does not check it.');
  });

  it('the rules text is written in the chosen language and marked with it', () => {
    const english = renderWithI18n(<Harness doc={edited()} tab="rules" rulesLocale="en" />);
    expect(english).toContain('lang="en"');
    expect(english).toContain('Starts from the rule preset Gen 9 OU.');
    expect(english).toContain('aria-pressed="true"');
    const german = renderWithI18n(<Harness doc={edited()} tab="rules" rulesLocale="de" />, { locale: 'de' });
    expect(german).toContain('lang="de"');
    expect(german).toContain('Startet vom Regel-Preset Gen 9 OU.');
    expect(german).toContain('Pokémon sind gebannt');
  });

  it('the rules text waits for a ruleset without errors', () => {
    expect(renderWithI18n(<Harness doc={broken()} tab="rules" />)).toContain('The rules text appears when the ruleset has no errors.');
  });
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
