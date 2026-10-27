/** @vitest-environment jsdom */
/**
 * The preview panel in a DOM: an ARIA tab list with Issues, Rules and Schedule (opened by clicking the tabs), the wiring
 * between tabs and panels, and what each tab shows for a clean and for a broken draft.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { describeDefinition } from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import { setBestOf, updateStage } from '@/lib/format-studio/editor/ops';
import { issueCounts, toIssueRows } from '@/lib/format-studio/editor/preview';
import PreviewPanel from '../../editor/preview/PreviewPanel';
import { compiled, expectNoLeftovers, expectUniqueIds, presetDoc } from './test-helpers';

type TabName = 'issues' | 'rules' | 'schedule';

/** Renders the panel on its first tab; `show` clicks another tab, as a viewer does. */
function open(doc: DraftDocument, locale: Locale = 'en') {
  const result = compiled(doc);
  const rows = toIssueRows(result.diagnostics);
  const view = render(
    withI18n(
      <PreviewPanel
        doc={doc}
        result={result}
        rows={rows}
        counts={issueCounts(result.diagnostics)}
        rulesets={[]}
        rulesetIds={new Set()}
        onEdit={() => undefined}
        onSelect={() => undefined}
      />,
      { locale },
    ),
  );
  const user = userEvent.setup();
  const tabs = () => screen.getAllByRole('tab');
  const index: Record<TabName, number> = { issues: 0, rules: 1, schedule: 2 };
  return { ...view, rows, user, tabs, show: (name: TabName) => user.click(tabs()[index[name]]) };
}

const selection = (tabs: HTMLElement[]) => tabs.map((tab) => tab.getAttribute('aria-selected'));

describe('PreviewPanel', () => {
  it('is an h2 section with a tab list of three tabs, Issues selected', () => {
    const { tabs } = open(presetDoc());
    expect(screen.getByRole('heading', { level: 2, name: 'Preview' })).toBeTruthy();
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(tabs()).toHaveLength(3);
    expect(selection(tabs())).toEqual(['true', 'false', 'false']);
    expect(tabs().map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('ties every tab to its panel and back, with unique ids', () => {
    const { container, tabs } = open(presetDoc());
    const panels = screen.getAllByRole('tabpanel', { hidden: true });
    expect(panels).toHaveLength(3);
    for (const tab of tabs()) {
      const panel = panels.find((candidate) => candidate.id === tab.getAttribute('aria-controls'));
      expect(panel, tab.id).toBeDefined();
      expect(panel!.getAttribute('aria-labelledby')).toBe(tab.id);
    }
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true, true]);
    expectUniqueIds(container.innerHTML);
  });

  it('counts the issues in the first tab label, in both languages', () => {
    const broken = updateStage(presetDoc(), 1, (s) => setBestOf(s, 2));
    const english = open(broken);
    expect(english.rows.length).toBeGreaterThan(0);
    expect(english.tabs()[0].textContent).toBe(`Issues (${english.rows.length})`);
    english.unmount();
    expect(open(broken, 'de').tabs()[0].textContent).toBe(`Probleme (${english.rows.length})`);
  });

  it('counts the issues of a clean draft too', () => {
    expect(open(presetDoc()).tabs()[0].textContent).toMatch(/^Issues \(\d+\)$/);
  });

  it('opens the tab that is clicked, and only that panel has content', async () => {
    const { tabs, show } = open(presetDoc());
    await show('rules');
    expect(selection(tabs())).toEqual(['false', 'true', 'false']);
    const doc = presetDoc();
    const [issuesPanel, rulesPanel, schedulePanel] = screen.getAllByRole('tabpanel', { hidden: true });
    expect(rulesPanel.hidden).toBe(false);
    expect(rulesPanel.textContent).toContain(describeDefinition(doc, 'en').overview);
    expect(issuesPanel.textContent).toBe('');
    expect(schedulePanel.textContent).toBe('');
    expect(screen.queryByLabelText('Number of players')).toBeNull();

    await show('schedule');
    expect(selection(tabs())).toEqual(['false', 'false', 'true']);
    expect(screen.getByLabelText('Number of players')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getAllByRole('tabpanel', { hidden: true })[1].textContent).toBe('');
  });

  it('the Rules tab warns that a draft with problems may be incomplete, and still shows the text', async () => {
    const broken = updateStage(presetDoc(), 1, (s) => setBestOf(s, 2));
    const view = open(broken);
    await view.show('rules');
    expect(screen.getByText('Draft with problems: the text may be incomplete.')).toBeTruthy();
    expect(view.container.textContent).toContain(describeDefinition(broken, 'en').overview);
    view.unmount();

    const clean = open(presetDoc());
    await clean.show('rules');
    expect(screen.queryByText(/Draft with problems/)).toBeNull();
  });

  it('the Schedule tab sends "Show the issues" back to the Issues tab', async () => {
    const broken = { ...presetDoc(), stages: [] } as unknown as DraftDocument;
    const { tabs, show, user } = open(broken);
    await show('schedule');
    await user.click(screen.getByRole('button', { name: 'Show the issues' }));
    expect(selection(tabs())).toEqual(['true', 'false', 'false']);
  });

  it.each(['en', 'de'] as const)('renders without leftovers in %s', async (locale) => {
    const { container, show } = open(presetDoc(), locale);
    for (const tab of ['issues', 'rules', 'schedule'] as const) {
      await show(tab);
      expectNoLeftovers(container.innerHTML);
    }
  });
});
