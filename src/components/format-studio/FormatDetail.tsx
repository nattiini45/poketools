'use client';

import { useMemo, type ReactNode } from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import { useLocale, useT } from '@/i18n/client';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';
import { describeDefinition } from '@/lib/format-kit/client';
import type { FormatView } from '@/lib/format-studio/view';
import DiagnosticsList from './DiagnosticsList';
import { Heading, type HeadingLevel } from './headingLevel';
import ModuleFacts from './ModuleFacts';
import RulesText from './RulesText';
import StageOutline from './StageOutline';

type Adapter = 'epb' | 'legacy_draft' | 'core_liga';

interface FormatDetailProps {
  view: FormatView;
  /** `page`: a route of its own (the page supplies the title); `tab`: inside the league admin's Format tab. */
  variant: 'page' | 'tab';
  /** An example format: shows the "Example" label and the read-only note. */
  example?: boolean;
  /** Where each legacy module's settings are edited; the links come from the loader, per available tab. */
  editorLinks?: Partial<Record<Adapter, string>>;
}

function Block({ title, level, children }: { title: string; level: HeadingLevel; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <Heading level={level} className="font-heading text-lg font-bold tracking-tight text-poke-text-primary">{title}</Heading>
      {children}
    </section>
  );
}

/**
 * The read-only view of one format: counts of findings, the stage outline, the generated rules text (with its
 * language toggle), the diagnostics in plain words, the coverage line and the legacy module facts. Everything is
 * derived from the locale-free `FormatView` after the read; nothing here can change data.
 *
 * Without a definition (the document did not validate) only the diagnostics are shown, with an alert.
 */
export default function FormatDetail({ view, variant, example = false, editorLinks }: FormatDetailProps) {
  const t = useT(formatStudioAdminMessages);
  const locale = useLocale();
  const tab = variant === 'tab';
  // A page has its own h1, so its blocks are h2; the league tab sits under the tab section's h2 and the format name (h3).
  const blockLevel: HeadingLevel = tab ? 3 : 2;

  const outline = useMemo(
    () =>
      view.definition === null
        ? null
        : describeDefinition(view.definition, locale, {
            plan: view.plan ?? undefined,
            order: view.order,
            rulesets: view.rulesets,
          }),
    [view, locale],
  );

  const errors = view.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = view.diagnostics.filter((d) => d.severity === 'warning').length;
  const notes = view.diagnostics.filter((d) => d.severity === 'info').length;

  const counts = (
    <div className="flex flex-wrap items-center gap-2">
      {example && <Badge variant="accent">{t('gallery.exampleBadge')}</Badge>}
      {errors > 0 && <Badge variant="red">{t('leagues.errors', { count: errors })}</Badge>}
      {warnings > 0 && <Badge variant="yellow">{t('leagues.warnings', { count: warnings })}</Badge>}
      {notes > 0 && <Badge variant="blue">{t('leagues.notes', { count: notes })}</Badge>}
      {errors + warnings + notes === 0 && <Badge variant="green">{t('leagues.noProblems')}</Badge>}
    </div>
  );

  return (
    <div className="min-w-0 space-y-6" data-format-detail={variant}>
      <header className="space-y-2">
        {/* A page has its own title; the tab names the format here. */}
        {tab && outline !== null && (
          <h3 className="break-words font-heading text-lg font-bold text-poke-text-primary">{outline.title}</h3>
        )}
        {outline?.summary != null && outline.summary !== '' && (
          <p className="break-words text-sm text-poke-text-secondary">{outline.summary}</p>
        )}
        {counts}
        {example && <p className="text-sm text-poke-text-muted">{t('gallery.readOnlyNote')}</p>}
      </header>

      {view.definition === null || outline === null ? (
        <>
          <Alert variant="error">{t('detail.invalid')}</Alert>
          <Block title={t('detail.diagnostics')} level={blockLevel}>
            <DiagnosticsList diagnostics={view.diagnostics} definition={null} />
          </Block>
        </>
      ) : (
        <>
          <Block title={t('detail.outline')} level={blockLevel}>
            <StageOutline stages={outline.stages} parentLevel={blockLevel} />
          </Block>

          <Block title={t('detail.rules')} level={blockLevel}>
            <RulesText parentLevel={blockLevel} definition={view.definition} plan={view.plan} order={view.order} rulesets={view.rulesets} />
          </Block>

          <Block title={t('detail.diagnostics')} level={blockLevel}>
            <DiagnosticsList diagnostics={view.diagnostics} definition={view.definition} />
          </Block>

          <Block title={t('detail.coverage')} level={blockLevel}>
            <p className="break-words text-sm text-poke-text-secondary">{outline.coverageLine}</p>
          </Block>

          {outline.modules.length > 0 && (
            <Block title={t('detail.modules')} level={blockLevel}>
              <ModuleFacts modules={outline.modules} editorLinks={editorLinks} parentLevel={blockLevel} />
            </Block>
          )}
        </>
      )}
    </div>
  );
}
