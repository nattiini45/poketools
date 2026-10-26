/**
 * The Ruleset Studio editor and its sections in static markup, in both languages: the wide layout with the outline, the
 * active section and the live summary; the base section for a preset and a blank base; the clause list with its honest
 * enforcement marks; team rules and notes; the unreadable-draft panel. Requests, dialogs and pointer behaviour are not run
 * here: the request layer, the reducers and the pure operations have their own tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds } from '@/test/markup';
import type { CatalogIndex } from '@/lib/pkmn/catalog-index';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { banEntries, allowEntries, setClause, setMode } from '@/lib/ruleset-kit/ops';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { clearCatalogCache, fetchCatalogIndex } from '@/lib/ruleset-studio/editor/catalog-client';
import { SPECIES_ROWS } from '@/lib/ruleset-studio/__tests__/editor/picker/fixtures';
import { ltext } from '@/lib/studio-core/ltext';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import RulesetEditor, { type RulesetEditorProps } from '../editor/RulesetEditor';
import OutlineNav, { changeCountOf } from '../editor/OutlineNav';
import BaseSection from '../sections/BaseSection';
import ClausesSection from '../sections/ClausesSection';
import ConstraintsSection from '../sections/ConstraintsSection';
import NotesSection from '../sections/NotesSection';

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

async function seedSpecies(): Promise<void> {
  const index: CatalogIndex<'species'> = { v: 1, kind: 'species', gen: 9, scope: 'standard', preset: null, rows: SPECIES_ROWS };
  await fetchCatalogIndex({ kind: 'species', gen: 9, scope: 'standard' }, { fetch: () => response(index) });
}

const doc = () => {
  let d = newRulesetDocument('Spring OU', 'en', 'gen9ou');
  d = banEntries(d, 'pokemon', ['garchomp'], PRESET.pokemon).doc;
  d = allowEntries(d, 'pokemon', ['koraidon'], PRESET.pokemon).doc;
  return setClause(d, 'ohkoclause', true, PRESET.clauses);
};

const SUMMARY: RulesetEditorProps['summary'] = {
  id: 'r1',
  slug: 'spring-ou',
  name: ltext('en', 'Spring OU', 'Frühling OU'),
  description: null,
  kind: 'custom',
  visibility: 'private',
  season_id: null,
  forked_from: null,
  draft_rev: 4,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-02T10:00:00Z',
  owner: { id: 'p1', name: 'Alex' },
  current_version: null,
};

function editor(over: Partial<RulesetEditorProps> = {}) {
  return (
    <RulesetEditor
      definitionId="r1"
      summary={SUMMARY}
      initial={{ document: doc(), draftRev: 4 }}
      published={null}
      actor={{ playerId: 'p1', isAdmin: false, leagueIds: [] }}
      initialPreset={PRESET}
      {...over}
    />
  );
}

beforeEach(() => clearCatalogCache());

describe('RulesetEditor', () => {
  it.each(['en', 'de'] as const)('lays out the toolbar, the eight sections, the active list and the live summary (%s)', async (locale) => {
    await seedSpecies();
    const html = renderWithI18n(editor(), { locale });
    expect(html).toContain('data-ruleset-editor');
    expect(html).toContain('Spring OU');
    const labels = locale === 'en'
      ? ['Base and basics', 'Clauses', 'Pokémon', 'Moves', 'Items', 'Abilities', 'Team rules', 'Notes']
      : ['Basis und Grundlagen', 'Klauseln', 'Pokémon', 'Attacken', 'Items', 'Fähigkeiten', 'Teamregeln', 'Notizen'];
    for (const label of labels) expect(html).toContain(esc(label));
    expect(html).toContain('id="rf-section-heading"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain(locale === 'en' ? 'Live summary' : 'Live-Zusammenfassung');
    expectUniqueIds(html);
    expectNoLeftovers(html);
    expectLabelledControls(html);
  });

  it('marks the open section as current and shows the counters of the document against its preset', async () => {
    await seedSpecies();
    const html = renderWithI18n(editor());
    expect(html).toMatch(/aria-current="page"[^>]*>(?:<span[^>]*>Pokémon<\/span>)/);
    expect(html).toContain('1 banned by you');
    expect(html).toContain('1 unbanned by you');
    expect(html).toContain('2 from the preset');
  });

  it('the summary compares the ruleset with its preset and counts what is in effect', async () => {
    await seedSpecies();
    const html = renderWithI18n(editor());
    expect(html).toContain('Compared with Gen 9 OU');
    expect(html).toContain('Gen 9 · Singles');
    expect(html).toContain('3 clauses');
  });

  it('keeps one polite live region for the announcements and a labelled status chip', async () => {
    await seedSpecies();
    const html = renderWithI18n(editor());
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-save-status="idle"');
    expect(html).toContain('All changes saved');
  });

  it('shows the publish state of the toolbar and the owner may delete', async () => {
    await seedSpecies();
    const html = renderWithI18n(editor({ published: { versionNo: 2, contentHash: 'h', resolvedHash: 'r' } }));
    expect(html).toContain('Version 2');
    expect(html).toContain('Delete');
  });

  it('a draft the form cannot show gets the error panel, a JSON download and an explicit way out', () => {
    const html = renderWithI18n(editor({ initial: { document: { nope: true }, draftRev: 2 } }));
    expect(html).toContain('This draft can not be shown in the editor');
    expect(html).toContain('download="ruleset-draft.json"');
    expect(html).toContain('Replace with a blank ruleset');
    expect(html).not.toContain('data-ruleset-editor');
    expect(renderWithI18n(editor({ initial: { document: null, draftRev: 2 } }), { locale: 'de' })).toContain('lässt sich im Editor nicht anzeigen');
  });
});

describe('OutlineNav', () => {
  it('counts the changes of each section and flags the sections with problems in words', () => {
    const d = doc();
    expect(changeCountOf(d, 'pokemon')).toBe(2);
    expect(changeCountOf(d, 'clauses')).toBe(1);
    expect(changeCountOf(d, 'moves')).toBe(0);
    expect(changeCountOf({ ...d, custom_rules: ' ' }, 'notes')).toBe(0);
    expect(changeCountOf({ ...d, min_shared_type_pct: 50, team_constraints: {} }, 'constraints')).toBe(2);
    const html = renderWithI18n(
      <OutlineNav
        doc={d}
        selected="clauses"
        onSelect={() => undefined}
        diagnostics={[
          { code: 'duplicate_entry', severity: 'error', path: '/pokemon/ban/1' },
          { code: 'ban_redundant', severity: 'warning', path: '/moves/ban/0' },
        ]}
      />,
    );
    expect(html).toContain('aria-label="1 issue"');
    expect(html).toContain('aria-label="2 changes"');
    expect(html).toMatch(/aria-current="page"[^>]*>(?:<span[^>]*>Clauses<\/span>)/);
    expect(html).toContain('aria-expanded="false"');
  });
});

describe('BaseSection', () => {
  const props = { onRetryPreset: () => undefined, loadPreset: async () => null, onChange: () => undefined, onReplace: () => undefined };

  it('a preset base shows the preset, what it rules out and the ways to change the base', () => {
    const html = renderWithI18n(<BaseSection doc={doc()} preset={PRESET} presetStatus="ready" {...props} />);
    expect(html).toContain('Gen 9 OU');
    expect(html).toContain('2 Pokémon ruled out');
    expect(html).toContain('1 move ruled out');
    expect(html).toContain('Change preset…');
    expect(html).toContain('Switch to a blank base');
    expect(html).toContain('id="rf-identity-name"');
    expectUniqueIds(html);
    expectLabelledControls(html);
  });

  it('a Smogon draft preset with documented extras offers the tour bans; others do not', () => {
    const draft = newRulesetDocument('Draft', 'en', 'gen9natdexdraft');
    const html = renderWithI18n(<BaseSection doc={draft} preset={{ ...PRESET, id: 'gen9natdexdraft' }} presetStatus="ready" {...props} />);
    expect(html).toContain('Add Smogon tour bans');
    expect(renderWithI18n(<BaseSection doc={doc()} preset={PRESET} presetStatus="ready" {...props} />)).not.toContain('Add Smogon tour bans');
  });

  it('says so while the preset loads and when it failed, with a retry', () => {
    expect(renderWithI18n(<BaseSection doc={doc()} preset={null} presetStatus="loading" {...props} />)).toContain('Loading the preset…');
    const failed = renderWithI18n(<BaseSection doc={doc()} preset={null} presetStatus="error" {...props} />);
    expect(failed).toContain('The preset rules could not be loaded.');
    expect(failed).toContain('Try again');
  });

  it('a blank base has generation, game type and universe fields', () => {
    const html = renderWithI18n(<BaseSection doc={newRulesetDocument('Blank', 'en')} preset={null} presetStatus="none" {...props} />);
    expect(html).toContain('Blank base');
    for (const label of ['Generation', 'Game type', 'Universe']) expect(html).toContain(label);
    expect(html).toContain('<option value="9" selected="">Gen 9 (SV)</option>');
    expectLabelledControls(html);
  });
});

describe('ClausesSection', () => {
  it('lists every clause, on or off against the preset, and says which ones the validator checks', () => {
    const d = setClause(doc(), 'sleepclausemod', false, PRESET.clauses);
    const html = renderWithI18n(<ClausesSection doc={d} preset={PRESET} generation={9} onToggle={() => undefined} />);
    expect(html).toContain('Species Clause');
    expect(html).toContain('Checked by the team validator');
    expect(html).toContain('Informational: applies in battle on Showdown');
    expect(html).toContain('Removed by you');
    expect(html).toContain('Added by you');
    expect(html).toContain('In the preset');
    expect(html).toContain('Only exists in generation 8');
    expect([...html.matchAll(/Checked by the team validator/g)]).toHaveLength(2);
    expectUniqueIds(html);
    expectLabelledControls(html);
  });

  it('a clause is checked when it is in effect', () => {
    const html = renderWithI18n(<ClausesSection doc={doc()} preset={PRESET} generation={9} onToggle={() => undefined} />);
    expect(html).toMatch(/id="rf-clauses-speciesclause"[^>]*checked=""|checked=""[^>]*id="rf-clauses-speciesclause"/);
    expect(html).not.toMatch(/id="rf-clauses-evasionclause"[^>]*checked=""/);
  });
});

describe('ConstraintsSection and NotesSection', () => {
  it('the shared type percentage and the team constraints editor are labelled', () => {
    const html = renderWithI18n(<ConstraintsSection doc={doc()} onChange={() => undefined} />);
    expect(html).toContain('Minimum share of the team that shares a type');
    expect(html).toContain('type="number"');
    expect(html).toContain('Team constraints');
  });

  it('the notes field counts the characters left and says they are never enforced', () => {
    const d = { ...doc(), custom_rules: 'No Tera in finals' };
    const html = renderWithI18n(<NotesSection doc={d} onChange={() => undefined} />);
    expect(html).toMatch(/4[,.]?983 characters left/);
    expect(html).toContain('never checked by the validator');
    expect(html).toContain('No Tera in finals');
    expectLabelledControls(html);
  });

  it('the allowlist doc of a list section is a document the notes section also shows', () => {
    const d = setMode(doc(), 'items', 'allow', ['leftovers']);
    expect(renderWithI18n(<NotesSection doc={d} onChange={() => undefined} />)).toContain('Notes and custom rules');
  });
});
