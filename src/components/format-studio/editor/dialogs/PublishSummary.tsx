'use client';

import { useLocale, useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import {
  computeCoverage,
  describeCoverage,
  renderDiagnostic,
  type CompileResult,
  type Diagnostic,
  type FormatDefinition,
} from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';

function Findings({ heading, items, doc }: { heading: string; items: readonly Diagnostic[]; doc: FormatDefinition }) {
  const locale = useLocale();
  if (items.length === 0) return null;
  return (
    <section className="space-y-1">
      <h3 className="font-heading text-sm font-semibold text-poke-text-primary">{heading}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-poke-text-secondary">
        {items.map((d, i) => (
          <li key={`${d.code}:${d.json_pointer}:${i}`} className="break-words">
            {renderDiagnostic(d, locale, doc)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What a format publish will do, in plain sentences: the compile result (errors block, warnings do not, notes are
 * counted) and the coverage line. The slot of the shared publish dialog (`studio-shell/dialogs/PublishDialog`).
 */
export default function PublishSummary({ doc, result }: { doc: DraftDocument; result: CompileResult }) {
  const t = useT(formatStudioEditorMessages);
  const locale = useLocale();
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
  const notes = result.diagnostics.filter((d) => d.severity === 'info');
  return (
    <>
      <Findings heading={t('publish.errorsHeading', { count: errors.length })} items={errors} doc={doc} />
      <Findings heading={t('publish.warningsHeading', { count: warnings.length })} items={warnings} doc={doc} />
      {notes.length > 0 && <p className="text-sm text-poke-text-muted">{t('publish.notes', { count: notes.length })}</p>}
      {errors.length === 0 && <p className="text-sm text-poke-text-secondary">{describeCoverage(computeCoverage(doc), locale)}</p>}
    </>
  );
}
