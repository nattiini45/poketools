'use client';

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useLocale, useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { renderDiagnostic, renderFix, renderSeverity, type Diagnostic, type Fix, type Severity } from '@/lib/format-kit/client';
import { applyFix, removeAtPointer } from '@/lib/format-studio/editor/ops';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import type { IssueRow } from '@/lib/format-studio/editor/preview';
import { jumpCandidates, type Selection } from '@/lib/format-studio/editor/targets';

const SEVERITY_VARIANT: Record<Severity, 'red' | 'yellow' | 'blue'> = { error: 'red', warning: 'yellow', info: 'blue' };

interface IssuesTabProps {
  doc: DraftDocument;
  /** The compiler's findings, and the same findings as rows (same order). */
  diagnostics: readonly Diagnostic[];
  rows: readonly IssueRow[];
  counts: { errors: number; warnings: number; notes: number };
  onEdit: (next: DraftDocument) => void;
  onSelect: (selection: Selection) => void;
}

/**
 * Moves focus to the field a finding is about: the field at the pointer, else the nearest parent that has an
 * element. Runs after the next paint so the inspector for the selection has rendered.
 */
export function focusPointer(pointer: string): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      for (const id of jumpCandidates(pointer)) {
        const element = document.getElementById(id);
        if (element === null) continue;
        element.focus();
        element.scrollIntoView({ block: 'center' });
        if (document.activeElement === element) return;
      }
    }),
  );
}

/**
 * The compiler's findings as a list of plain sentences. Each row names its severity in a word, can jump to the
 * field it is about, offers its one-click fixes and, for a field the form does not know, removing it. Applying a
 * fix or removing a field is announced in a polite status region.
 */
export default function IssuesTab({ doc, diagnostics, rows, counts, onEdit, onSelect }: IssuesTabProps) {
  const t = useT(formatStudioEditorMessages);
  const locale = useLocale();
  const [announcement, setAnnouncement] = useState('');

  const fix = (fix: Fix) => {
    const result = applyFix(doc, fix);
    if (!result.ok) return;
    onEdit(result.doc);
    setAnnouncement(t('preview.issues.applied', { label: renderFix(fix, locale) }));
  };
  const remove = (pointer: string) => {
    const result = removeAtPointer(doc, pointer);
    if (!result.ok) return;
    onEdit(result.doc);
    setAnnouncement(t('preview.issues.removed'));
  };

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-sm text-poke-text-secondary">
        <span>{t('toolbar.issues.errors', { count: counts.errors })}</span>
        <span aria-hidden="true">·</span>
        <span>{t('toolbar.issues.warnings', { count: counts.warnings })}</span>
        <span aria-hidden="true">·</span>
        <span>{t('toolbar.issues.notes', { count: counts.notes })}</span>
      </p>

      {rows.length === 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-poke-text-secondary">
          <Badge variant="green">{t('preview.issues.none')}</Badge>
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row, i) => {
            const diagnostic = diagnostics[i];
            const sentence = diagnostic === undefined ? row.code : renderDiagnostic(diagnostic, locale, doc);
            return (
              <li key={row.id} className="min-w-0 space-y-2 rounded-poke-md border border-poke-border p-3">
                <div className="flex flex-col items-start gap-1 sm:flex-row sm:gap-3">
                  <Badge variant={SEVERITY_VARIANT[row.severity]} className="shrink-0">
                    {renderSeverity(row.severity, locale)}
                  </Badge>
                  <span className="min-w-0 break-words text-sm text-poke-text-primary">{sentence}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.selection !== null ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-h-11 sm:min-h-0"
                      onClick={() => {
                        if (row.selection === null) return;
                        onSelect(row.selection);
                        focusPointer(row.pointer);
                      }}
                    >
                      {t('preview.issues.goTo')}
                    </Button>
                  ) : (
                    <span className="text-xs text-poke-text-muted">{t('preview.issues.noTarget')}</span>
                  )}
                  {row.fixes.map((f, j) => (
                    <Button key={`${f.id}-${j}`} type="button" variant="primary" size="sm" className="min-h-11 sm:min-h-0" onClick={() => fix(f)}>
                      {t('preview.issues.apply', { label: renderFix(f, locale) })}
                    </Button>
                  ))}
                  {row.canRemove && (
                    <Button type="button" variant="danger" size="sm" className="min-h-11 sm:min-h-0" onClick={() => remove(row.pointer)}>
                      {t('preview.issues.remove')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
