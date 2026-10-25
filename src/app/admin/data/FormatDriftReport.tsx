'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Section from '@/components/ui/Section';
import {
  FORMAT_DRIFT_MAX_ROWS,
  type AdvancementDriftCase,
  type DriftPhaseRef,
  type FormatDriftReport as FormatDriftReportData,
  type TiebreakerDriftCase,
} from '@/lib/admin/format-drift';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import { useFormatter, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import type { TiebreakerStep } from '@/types/format-rules';
import type { ApiResult } from '@/types/api';

export type FormatDriftState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed'; error: ApiErrorLike | null }
  | { status: 'loaded' };

interface FormatDriftReportViewProps {
  state: FormatDriftState;
  /** The loaded report; read only when `state.status` is `loaded`. */
  report?: FormatDriftReportData | null;
  onRun?: () => void;
}

/** The tiebreaker chain of a league as a numbered list, with the labels of the rules page. */
function TiebreakerChain({ label, steps }: { label: string; steps: readonly TiebreakerStep[] }) {
  const tAdmin = useT(leagueAdminMessages);
  const tGlossary = useT(glossaryMessages);
  const stepLabel = (step: TiebreakerStep): string => {
    switch (step) {
      case 'evolution_points':
        return tGlossary('progress.evolutionPoints');
      case 'match_points':
        return tAdmin('formatRules.tiebreaker.match_points');
      case 'kill_difference':
        return tAdmin('formatRules.tiebreaker.kill_difference');
      case 'head_to_head':
        return tAdmin('formatRules.tiebreaker.head_to_head');
      case 'decision_match':
        return tAdmin('formatRules.tiebreaker.decision_match');
    }
  };
  return (
    <div className="min-w-0">
      <p className="text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-muted">{label}</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-poke-text-primary">
        {steps.map((step) => (
          <li key={step}>{stepLabel(step)}</li>
        ))}
      </ol>
    </div>
  );
}

function LeagueBadges({ archived, isTest }: { archived: boolean; isTest: boolean }) {
  const t = useT(adminToolsMessages);
  return (
    <>
      {archived && <Badge variant="gray" size="xs">{t('data.formatDrift.archivedBadge')}</Badge>}
      {isTest && <Badge variant="yellow" size="xs">{t('data.formatDrift.testBadge')}</Badge>}
    </>
  );
}

function TiebreakerCaseCard({ item, packChain }: { item: TiebreakerDriftCase; packChain: readonly TiebreakerStep[] }) {
  const t = useT(adminToolsMessages);
  return (
    <li>
      <Card variant="muted" padding="sm">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={leagueAdminHref(item.seasonId, 'rules')} className="text-sm font-medium text-poke-blue hover:underline">
            {item.seasonName}
          </Link>
          <LeagueBadges archived={item.archived} isTest={item.isTest} />
        </div>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <TiebreakerChain label={t('data.formatDrift.tiebreaker.stored')} steps={item.stored} />
          <TiebreakerChain label={t('data.formatDrift.tiebreaker.pack')} steps={packChain} />
        </div>
      </Card>
    </li>
  );
}

/** `top 4`, `top 2 per group` or `none` for one side of a phase pair. */
function RuleText({ rule }: { rule: DriftPhaseRef['rule'] }) {
  const t = useT(adminToolsMessages);
  if (!rule) return <>{t('data.formatDrift.advancement.ruleNone')}</>;
  return (
    <>
      {t(rule.per_group ? 'data.formatDrift.advancement.ruleTopPerGroup' : 'data.formatDrift.advancement.ruleTop', {
        count: rule.count,
      })}
    </>
  );
}

function PhaseLine({ seasonId, label, phase }: { seasonId: string; label: string; phase: DriftPhaseRef }) {
  return (
    <div className="min-w-0 text-sm">
      <p className="text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-muted">{label}</p>
      <p className="text-poke-text-primary">
        <Link href={`/admin/leagues/${seasonId}/phases/${phase.id}`} className="font-medium text-poke-blue hover:underline">
          {phase.stageOrder + 1}. {phase.name}
        </Link>
        <span className="text-poke-text-secondary">
          {' · '}
          <RuleText rule={phase.rule} />
        </span>
      </p>
    </div>
  );
}

function AdvancementCaseCard({ item }: { item: AdvancementDriftCase }) {
  const t = useT(adminToolsMessages);
  return (
    <li>
      <Card variant="muted" padding="sm">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={leagueAdminHref(item.seasonId, 'phases')} className="text-sm font-medium text-poke-blue hover:underline">
            {item.seasonName}
          </Link>
          <LeagueBadges archived={item.archived} isTest={item.isTest} />
          <Badge variant="accent" size="xs">{t(`data.formatDrift.advancement.kindLabel.${item.kind}`)}</Badge>
        </div>
        <p className="mt-1 text-sm text-poke-text-secondary">{t(`data.formatDrift.advancement.kind.${item.kind}`)}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {item.source && (
            <PhaseLine
              seasonId={item.seasonId}
              label={t('data.formatDrift.advancement.source')}
              phase={item.source}
            />
          )}
          {item.target && (
            <PhaseLine
              seasonId={item.seasonId}
              label={t('data.formatDrift.advancement.target')}
              phase={item.target}
            />
          )}
        </div>
      </Card>
    </li>
  );
}

function SummaryItem({ children }: { children: string }) {
  return (
    <li className="rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 text-sm text-poke-text-primary">
      {children}
    </li>
  );
}

function LoadedReport({ report }: { report: FormatDriftReportData }) {
  const t = useT(adminToolsMessages);
  const formatter = useFormatter();
  const { tiebreaker, advancement } = report;
  const pairsMismatching = advancement.pairsChecked - advancement.consistentPairs;

  return (
    <div className="mt-4 space-y-5">
      <p className="text-xs text-poke-text-muted">
        {t('data.formatDrift.generatedAt', { time: formatter.instant(report.generatedAt, 'dateTimeYear') })}
      </p>
      <Alert variant="info">{t('data.formatDrift.readOnlyNote')}</Alert>
      {(report.truncated.formatRules || report.truncated.phases) && (
        <Alert variant="warning">
          {t('data.formatDrift.truncated', { max: formatter.number(FORMAT_DRIFT_MAX_ROWS) })}
        </Alert>
      )}

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryItem>{t('data.formatDrift.summary.leaguesChecked', { count: tiebreaker.checked })}</SummaryItem>
        <SummaryItem>{t('data.formatDrift.summary.tiebreakerMismatches', { count: tiebreaker.cases.length })}</SummaryItem>
        <SummaryItem>{t('data.formatDrift.summary.pairsChecked', { count: advancement.pairsChecked })}</SummaryItem>
        <SummaryItem>{t('data.formatDrift.summary.pairsConsistent', { count: advancement.consistentPairs })}</SummaryItem>
        <SummaryItem>{t('data.formatDrift.summary.pairsMismatching', { count: pairsMismatching })}</SummaryItem>
      </ul>

      <section aria-labelledby="format-drift-tiebreaker" className="space-y-2">
        <h3 id="format-drift-tiebreaker" className="font-heading text-base font-semibold text-poke-text-primary">
          {t('data.formatDrift.tiebreaker.title')}
        </h3>
        <p className="text-sm text-poke-text-muted">{t('data.formatDrift.tiebreaker.intro')}</p>
        {tiebreaker.cases.length === 0 ? (
          <p className="text-sm text-poke-text-secondary">{t('data.formatDrift.tiebreaker.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {tiebreaker.cases.map((item) => (
              <TiebreakerCaseCard key={item.seasonId} item={item} packChain={report.packChain} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="format-drift-advancement" className="space-y-2">
        <h3 id="format-drift-advancement" className="font-heading text-base font-semibold text-poke-text-primary">
          {t('data.formatDrift.advancement.title')}
        </h3>
        <p className="text-sm text-poke-text-muted">{t('data.formatDrift.advancement.intro')}</p>
        {advancement.cases.length === 0 ? (
          <p className="text-sm text-poke-text-secondary">{t('data.formatDrift.advancement.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {advancement.cases.map((item) => (
              <AdvancementCaseCard key={`${item.seasonId}:${item.source?.id ?? ''}:${item.target?.id ?? ''}`} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Props-driven view: every state renders without effects or fetches, so it can be rendered statically in tests. */
export function FormatDriftReportView({ state, report, onRun }: FormatDriftReportViewProps) {
  const t = useT(adminToolsMessages);
  const apiErrorText = useApiErrorText(errorsAdmin);
  const running = state.status === 'loading';

  return (
    <Section title={t('data.formatDrift.title')} subtitle={t('data.formatDrift.subtitle')}>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={state.status === 'failed' ? 'secondary' : 'primary'}
          size="sm"
          onClick={onRun}
          disabled={running}
        >
          {running
            ? t('data.formatDrift.running')
            : state.status === 'failed'
              ? t('data.formatDrift.retry')
              : t('data.formatDrift.run')}
        </Button>
      </div>
      {state.status === 'failed' && (
        <Alert variant="error" className="mt-4" role="alert">
          {state.error?.code ? apiErrorText(state.error) : t('data.formatDrift.failed')}
        </Alert>
      )}
      {state.status === 'loaded' && report && <LoadedReport report={report} />}
    </Section>
  );
}

/** Loads the report on demand: the page does not read anything until the admin asks for it. */
export default function FormatDriftReport() {
  const [state, setState] = useState<FormatDriftState>({ status: 'idle' });
  const [report, setReport] = useState<FormatDriftReportData | null>(null);

  const run = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch('/api/admin/format-drift');
      const json: ApiResult<FormatDriftReportData> = await res.json();
      if (json.success && json.data) {
        setReport(json.data);
        setState({ status: 'loaded' });
      } else {
        setState({ status: 'failed', error: toApiErrorLike(json) });
      }
    } catch (err) {
      setState({ status: 'failed', error: toApiErrorLike(err) });
    }
  }, []);

  return <FormatDriftReportView state={state} report={report} onRun={() => void run()} />;
}
