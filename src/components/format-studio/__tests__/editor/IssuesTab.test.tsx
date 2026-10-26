/**
 * The Issues tab (static markup): one row per finding in the compiler's order, the sentence the shared renderer
 * writes, the severity as a word, Go to field, one button per one-click fix, Remove for an unknown field, and the
 * empty state.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { renderDiagnostic, renderFix, renderSeverity } from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import { setBestOf, updateStage } from '@/lib/format-studio/editor/ops';
import { issueCounts, toIssueRows } from '@/lib/format-studio/editor/preview';
import IssuesTab from '../../editor/preview/IssuesTab';
import { compiled, esc, expectNoLeftovers, presetDoc } from './test-helpers';

function render(doc: DraftDocument, locale: Locale = 'en') {
  const result = compiled(doc);
  return {
    result,
    html: renderWithI18n(
      <IssuesTab
        doc={doc}
        diagnostics={result.diagnostics}
        rows={toIssueRows(result.diagnostics)}
        counts={issueCounts(result.diagnostics)}
        onEdit={() => undefined}
        onSelect={() => undefined}
      />,
      { locale },
    ),
  };
}

/** An even best-of in the first stage and in a round exception: two errors, each with fixes. */
const withProblems = (): DraftDocument =>
  updateStage(presetDoc(), 1, (s) => ({ ...setBestOf(s, 2), scoring: { ...s.scoring, draw: 1 } }));

/** A member the schema does not know: the validator stops there, so this is the only finding. */
const withUnknownField = (): DraftDocument => ({ ...presetDoc(), extra_member: 1 }) as DraftDocument;

describe('IssuesTab', () => {
  it.each(['en', 'de'] as const)('writes every finding as the shared renderer does, in the compiler order (%s)', (locale) => {
    const doc = withProblems();
    const { result, html } = render(doc, locale);
    expect(result.diagnostics.length).toBeGreaterThan(1);
    let from = 0;
    for (const diagnostic of result.diagnostics) {
      const sentence = esc(renderDiagnostic(diagnostic, locale, doc));
      const at = html.indexOf(sentence, from);
      expect(at, sentence).toBeGreaterThanOrEqual(from);
      from = at;
    }
    expectNoLeftovers(html);
  });

  it('names the severity in a word for every row', () => {
    const doc = withProblems();
    const { result, html } = render(doc);
    for (const severity of new Set(result.diagnostics.map((d) => d.severity))) {
      expect(html).toContain(`>${renderSeverity(severity, 'en')}<`);
    }
  });

  it('offers Go to field for a finding the form has a place for, and says so for one it has not', () => {
    const doc = withProblems();
    const { result, html } = render(doc);
    const rows = toIssueRows(result.diagnostics);
    const withTarget = rows.filter((r) => r.selection !== null).length;
    expect(withTarget).toBeGreaterThan(0);
    expect((html.match(/>Go to field</g) ?? []).length).toBe(withTarget);
    const unknown = render(withUnknownField());
    expect(unknown.html).not.toContain('>Go to field<');
    expect(unknown.html).toContain('No field for this one in the form.');
  });

  it('offers one button per one-click fix, labelled by the fix text', () => {
    const doc = withProblems();
    const { result, html } = render(doc);
    const finding = result.diagnostics.find((d) => d.code === 'series_even_best_of');
    expect(finding?.fixes.length).toBeGreaterThanOrEqual(1);
    for (const fix of finding!.fixes) {
      expect(html).toContain(esc(`Apply: ${renderFix(fix, 'en')}`));
    }
  });

  it('offers Remove this field for an unknown member, and only for those', () => {
    expect((render(withProblems()).html.match(/>Remove this field</g) ?? []).length).toBe(0);
    const { result, html } = render(withUnknownField());
    expect(toIssueRows(result.diagnostics).filter((r) => r.canRemove)).toHaveLength(1);
    expect((html.match(/>Remove this field</g) ?? []).length).toBe(1);
    expect(render(withUnknownField(), 'de').html).toContain('Dieses Feld entfernen');
  });

  it('shows the counts as text', () => {
    const { result, html } = render(withProblems());
    const counts = issueCounts(result.diagnostics);
    expect(html).toContain(`${counts.errors} error`);
  });

  it('a clean document shows the empty state and no list', () => {
    const { result, html } = render(presetDoc());
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    if (result.diagnostics.length === 0) {
      expect(html).toContain('No problems found');
      expect(html).not.toContain('<ul');
    }
  });

  it('is a plain list, not a table', () => {
    const { html } = render(withProblems());
    expect(html).toContain('<ul');
    expect(html).not.toContain('<table');
  });
});
