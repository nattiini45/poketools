'use client';

import Badge from '@/components/ui/Badge';
import { useLocale, useT } from '@/i18n/client';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';
import { renderDiagnostic, renderSeverity, type Diagnostic, type FormatDefinition, type Severity } from '@/lib/format-kit/client';

const SEVERITY_VARIANT: Record<Severity, 'red' | 'yellow' | 'blue'> = {
  error: 'red',
  warning: 'yellow',
  info: 'blue',
};

interface DiagnosticsListProps {
  diagnostics: readonly Diagnostic[];
  /** With the definition, stage and rule keys read as names. */
  definition: FormatDefinition | null;
}

/**
 * The compiler's findings as sentences, in the order the compiler sorted them (errors first). The severity is a
 * word in a badge, never colour alone. Fixes are not offered: nothing in the Studio is editable yet.
 */
export default function DiagnosticsList({ diagnostics, definition }: DiagnosticsListProps) {
  const t = useT(formatStudioAdminMessages);
  const locale = useLocale();

  if (diagnostics.length === 0) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-poke-text-secondary">
        <Badge variant="green">{t('leagues.noProblems')}</Badge>
        <span>{t('detail.diagnosticsNone')}</span>
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {diagnostics.map((d, i) => (
        <li key={`${d.code}:${d.json_pointer}:${i}`} className="flex flex-col items-start gap-1 sm:flex-row sm:gap-3">
          <Badge variant={SEVERITY_VARIANT[d.severity]} className="shrink-0">
            {renderSeverity(d.severity, locale)}
          </Badge>
          <span className="min-w-0 break-words text-sm text-poke-text-primary">
            {renderDiagnostic(d, locale, definition ?? undefined)}
          </span>
        </li>
      ))}
    </ul>
  );
}
