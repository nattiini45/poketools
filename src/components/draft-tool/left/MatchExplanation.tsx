'use client';

/**
 * Why the pinned line matches the active filters, by stage
 * (draft-frontend §4.7 rule 5, SPEC:297-312):
 * "Recovery ✓ — Regenerator, from Stage 3", "All at once – from Stage 3".
 * When the line no longer matches, every criterion shows ✓/✕; when only the
 * price tab hides it, a single note says so.
 */
import { useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import type { CriterionResult, LineEvaluation } from '@/lib/draft-finder/engine';
import type { CriterionLabel } from './criterion-text';

export interface MatchExplanationProps {
  evaluation: LineEvaluation | null;
  criteria: CriterionLabel[];
  /** Per-result reason text ("Regenerator, from Stage 3"), already translated. */
  reasons: Record<string, string | null>;
  visibleInResults: boolean;
  hiddenByTab: boolean;
}

function Row({ result, label, reason }: { result: CriterionResult; label: string; reason: string | null }) {
  const t = useT(draftScreenMessages);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className={result.satisfied ? 'font-semibold' : 'text-[var(--draft-ink-2)]'}>
        {result.satisfied ? t('explain.matched', { criterion: label }) : t('explain.failed', { criterion: label })}
      </span>
      {reason ? <span className="text-[var(--draft-ink-2)]">{reason}</span> : null}
    </li>
  );
}

export default function MatchExplanation({ evaluation, criteria, reasons, visibleInResults, hiddenByTab }: MatchExplanationProps) {
  const t = useT(draftScreenMessages);
  if (!evaluation || evaluation.results.length === 0) return null;
  const labelOf = new Map(criteria.map((c) => [c.id, c.label]));
  const rows = evaluation.results.map((r) => (
    <Row key={r.criterionId} result={r} label={labelOf.get(r.criterionId) ?? r.criterionId} reason={reasons[r.criterionId] ?? null} />
  ));

  if (!visibleInResults && hiddenByTab && evaluation.matches) {
    return <p className="text-sm text-[var(--draft-ink-2)]">{t('explain.notInTab')}</p>;
  }

  if (!visibleInResults && !evaluation.matches) {
    return (
      <section className="flex flex-col gap-1" aria-label={t('explain.noLonger')}>
        <p className="text-sm font-semibold">{t('explain.noLonger')}</p>
        <ul className="flex flex-col gap-0.5">{rows}</ul>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-1" aria-label={t('explain.title')}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--draft-ink-2)]">{t('explain.title')}</h3>
      <ul className="flex flex-col gap-0.5">{rows}</ul>
      {evaluation.results.length > 1 ? (
        <p className="text-sm font-semibold">
          {evaluation.simultaneousFromStage !== null
            ? t('explain.allAtOnce', { stage: evaluation.simultaneousFromStage })
            : t('explain.notAtOnce')}
        </p>
      ) : null}
    </section>
  );
}
