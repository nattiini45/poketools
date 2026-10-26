/**
 * The preview panel (static markup): an ARIA tab list with Issues, Rules and Schedule, the wiring between tabs
 * and panels, and what each tab shows for a clean and for a broken draft.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { describeDefinition } from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import { setBestOf, updateStage } from '@/lib/format-studio/editor/ops';
import { issueCounts, toIssueRows } from '@/lib/format-studio/editor/preview';
import PreviewPanel, { type PreviewTabId } from '../../editor/preview/PreviewPanel';
import { compiled, esc, expectNoLeftovers, expectUniqueIds, presetDoc } from './test-helpers';

function render(doc: DraftDocument, locale: Locale = 'en', initialTab?: PreviewTabId) {
  const result = compiled(doc);
  const rows = toIssueRows(result.diagnostics);
  return {
    rows,
    html: renderWithI18n(
      <PreviewPanel
        doc={doc}
        result={result}
        rows={rows}
        counts={issueCounts(result.diagnostics)}
        rulesets={[]}
        rulesetIds={new Set()}
        initialTab={initialTab}
        onEdit={() => undefined}
        onSelect={() => undefined}
      />,
      { locale },
    ),
  };
}

const tag = (html: string, role: string) => [...html.matchAll(new RegExp(`<[a-z]+[^>]*role="${role}"[^>]*>`, 'g'))].map((m) => m[0]);
const attr = (element: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(element)?.[1] ?? null;

describe('PreviewPanel', () => {
  it('is an h2 section with a tab list of three tabs, Issues selected', () => {
    const { html } = render(presetDoc());
    expect(html).toMatch(/<h2[^>]*>Preview<\/h2>/);
    expect(tag(html, 'tablist')).toHaveLength(1);
    const tabs = tag(html, 'tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => attr(t, 'aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => attr(t, 'tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('ties every tab to its panel and back, with unique ids', () => {
    const { html } = render(presetDoc());
    const tabs = tag(html, 'tab');
    const panels = tag(html, 'tabpanel');
    expect(panels).toHaveLength(3);
    for (const tab of tabs) {
      const panel = panels.find((p) => attr(p, 'id') === attr(tab, 'aria-controls'));
      expect(panel, attr(tab, 'id') ?? '').toBeDefined();
      expect(attr(panel!, 'aria-labelledby')).toBe(attr(tab, 'id'));
    }
    expect(panels.map((p) => p.includes('hidden=""'))).toEqual([false, true, true]);
    expectUniqueIds(html);
  });

  it('counts the issues in the first tab label, in both languages', () => {
    const broken = updateStage(presetDoc(), 1, (s) => setBestOf(s, 2));
    const { html, rows } = render(broken);
    expect(rows.length).toBeGreaterThan(0);
    expect(html).toContain(`Issues (${rows.length})`);
    expect(render(broken, 'de').html).toContain(`Probleme (${rows.length})`);
    expect(render(presetDoc()).html).toMatch(/Issues \(\d+\)/);
  });

  it('starts on the tab it is told to, and only that panel has content', () => {
    const rules = render(presetDoc(), 'en', 'rules').html;
    expect(attr(tag(rules, 'tab')[1], 'aria-selected')).toBe('true');
    const doc = presetDoc();
    expect(rules).toContain(esc(describeDefinition(doc, 'en').overview));
    expect(rules).not.toContain('Number of players');
    const schedule = render(presetDoc(), 'en', 'schedule').html;
    expect(attr(tag(schedule, 'tab')[2], 'aria-selected')).toBe('true');
    expect(schedule).toContain('Number of players');
    expect(schedule).toContain('<table');
  });

  it('the Rules tab warns that a draft with problems may be incomplete, and still shows the text', () => {
    const broken = updateStage(presetDoc(), 1, (s) => setBestOf(s, 2));
    const html = render(broken, 'en', 'rules').html;
    expect(html).toContain('Draft with problems: the text may be incomplete.');
    expect(html).toContain(esc(describeDefinition(broken, 'en').overview));
    expect(render(presetDoc(), 'en', 'rules').html).not.toContain('Draft with problems');
  });

  it.each(['en', 'de'] as const)('renders without leftovers in %s', (locale) => {
    for (const tab of ['issues', 'rules', 'schedule'] as const) expectNoLeftovers(render(presetDoc(), locale, tab).html);
  });
});
