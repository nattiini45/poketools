/** @vitest-environment jsdom */
/**
 * The live summary column in a DOM, in both languages: the four tabs (opened by clicking them, as a viewer does), the issue
 * rows with their fixes, the change list with revert buttons, and the rules text in English and German. A small harness
 * runs the real editor hook so the panel reads a real compile.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import { expectLabelledControls, expectNoLeftovers, expectUniqueIds } from '@/test/markup';
import type { CatalogIndex } from '@/lib/pkmn/catalog-index';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { banEntries, setClause } from '@/lib/ruleset-kit/ops';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { clearCatalogCache, fetchEntryIndex } from '@/lib/ruleset-studio/editor/catalog-client';
import { SPECIES_ROWS } from '@/lib/ruleset-studio/__tests__/editor/picker/fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { useRulesetEditor } from '../editor/useRulesetEditor';
import SummaryPanel from '../summary/SummaryPanel';

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
  await fetchEntryIndex({ kind: 'species', gen: 9, scope: 'standard' }, { fetch: () => response(index) });
}

function Harness({ doc }: { doc: ReturnType<typeof newRulesetDocument> }) {
  const model = useRulesetEditor({ definitionId: 'r1', initialDoc: doc, initialRev: 1, initialPreset: PRESET });
  return <SummaryPanel model={model} onSelectSection={() => undefined} onApplyFix={() => undefined} />;
}

/** Renders the panel and returns the user, who opens a tab by clicking it (the tab name may carry a count badge). */
function open(doc: ReturnType<typeof newRulesetDocument>, locale: 'en' | 'de' = 'en') {
  const view = render(withI18n(<Harness doc={doc} />, { locale }));
  const user = userEvent.setup();
  return { ...view, user, goTo: (name: RegExp) => user.click(screen.getByRole('tab', { name })) };
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
  it.each([
    ['en', ['Summary', 'Changes', 'Issues', 'Rules text']],
    ['de', ['Überblick', 'Änderungen', 'Probleme', 'Regeltext']],
  ] as const)('has the four tabs as a tablist with the selected one controlling its panel (%s)', (locale, names) => {
    const { container } = open(edited(), locale);
    expect(screen.getByRole('tablist')).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs.map((tab) => tab.textContent?.replace(/\d+$/, ''))).toEqual(names);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
    expectUniqueIds(container.innerHTML);
    expectNoLeftovers(container.innerHTML);
    expectLabelledControls(container.innerHTML);
  });

  it('the summary tab compares with the preset and counts what is in effect', () => {
    open(edited());
    expect(screen.getByText('Compared with Gen 9 OU')).toBeTruthy();
    expect(screen.getByText('2 banned, 0 unbanned')).toBeTruthy();
    expect(screen.getByRole('button', { name: '3 Pokémon banned' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2 moves banned' })).toBeTruthy();
    expect(screen.getByText(/^2 from the preset/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 clause' })).toBeTruthy();
  });

  it('says so when nothing differs from the base', () => {
    open(newRulesetDocument('Plain', 'en', 'gen9ou'));
    expect(screen.getByText('No changes against the base yet.')).toBeTruthy();
  });

  it('the changes tab lists every entry with a revert button named after it, and clause switches', async () => {
    const { goTo } = open(edited());
    await goTo(/^Changes/);
    expect(screen.getByRole('tab', { name: /^Changes/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Your changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revert Garchomp' })).toBeTruthy();
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items.some((text) => text?.startsWith('Banned: '))).toBe(true);
    expect(items.some((text) => text?.startsWith('Clause removed: ') && text.includes('Sleep Clause Mod'))).toBe(true);
  });

  it('the issues tab names each problem in words, with its severity, a way to the field and a one-click fix', async () => {
    const { container, goTo } = open(broken());
    await goTo(/^Issues/);
    const text = container.textContent ?? '';
    expect(text).toContain('is listed twice in Pokémon');
    expect(text).toContain('is both banned and unbanned in Pokémon');
    expect(screen.getAllByText('Error').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Go to the field' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Fix: Remove the entry' }).length).toBeGreaterThan(0);
    expectNoLeftovers(container.innerHTML);
  });

  it('the issues tab of a clean ruleset says there is nothing to fix; informational clauses show as notes', async () => {
    const clean = open(newRulesetDocument('Plain', 'en'));
    await clean.goTo(/^Issues/);
    expect(screen.getByRole('status').textContent).toBe('No problems found.');
    clean.unmount();

    const { goTo } = open(newRulesetDocument('Plain', 'en', 'gen9ou'));
    await goTo(/^Issues/);
    expect(screen.getByText('Note')).toBeTruthy();
    expect(screen.getByText('The clause Sleep Clause Mod is shown on the rules page but the team validator does not check it.')).toBeTruthy();
  });

  it("the rules text opens in the viewer's language and is marked with it", async () => {
    const english = open(edited());
    await english.goTo(/^Rules text/);
    const englishText = english.container.querySelector('[lang="en"]');
    expect(englishText?.textContent).toContain('Starts from the rule preset Gen 9 OU.');
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
    english.unmount();

    const german = open(edited(), 'de');
    await german.goTo(/^Regeltext/);
    const germanText = german.container.querySelector('[lang="de"]');
    expect(germanText?.textContent).toContain('Startet vom Regel-Preset Gen 9 OU.');
    expect(germanText?.textContent).toContain('Pokémon sind gebannt');
    expect(screen.getByRole('button', { name: 'Deutsch' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('the rules text toggle writes the text in the other language', async () => {
    const { container, goTo, user } = open(edited());
    await goTo(/^Rules text/);
    await user.click(screen.getByRole('button', { name: 'Deutsch' }));
    expect(container.querySelector('[lang="de"]')?.textContent).toContain('Startet vom Regel-Preset Gen 9 OU.');
    expect(container.querySelector('[lang="en"]')).toBeNull();
    expect(within(screen.getByRole('group')).getByRole('button', { name: 'Deutsch' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('the rules text waits for a ruleset without errors', async () => {
    const { goTo } = open(broken());
    await goTo(/^Rules text/);
    expect(screen.getByText('The rules text appears when the ruleset has no errors.')).toBeTruthy();
  });
});
