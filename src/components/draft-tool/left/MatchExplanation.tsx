'use client';

/**
 * Why the pinned line matches the active filters (draft-frontend §4.7 rule 5, SPEC:297-312): the same rows
 * the roster card's hover popover shows ("Recovery ✓ – Regenerator, from Incineroar", "All at once – from
 * Incineroar"), rendered by the shared `MatchReasons`. When the line no longer matches, every criterion
 * shows ✓/✕; when only the price tab hides it, a single note says so.
 */
import { useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import type { LineEvaluation } from '@/lib/draft-finder/engine';
import type { FinderFilters, StageMode } from '@/lib/draft-finder/filter-types';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import MatchReasons from '../shared/MatchReasons';

export interface MatchExplanationProps {
  evaluation: LineEvaluation | null;
  /** The pinned line, whose stages name the Pokémon each result first holds on. */
  entry: DraftLineCatalogEntry;
  filters: FinderFilters;
  ix: PreparedIndex | null;
  stageMode: StageMode;
  names?: NameResolver;
  visibleInResults: boolean;
  hiddenByTab: boolean;
}

export default function MatchExplanation({
  evaluation,
  entry,
  filters,
  ix,
  stageMode,
  names,
  visibleInResults,
  hiddenByTab,
}: MatchExplanationProps) {
  const t = useT(draftScreenMessages);
  if (!evaluation || evaluation.results.length === 0) return null;

  if (!visibleInResults && hiddenByTab && evaluation.matches) {
    return <p className="text-sm text-[var(--draft-ink-2)]">{t('explain.notInTab')}</p>;
  }

  const reasons = <MatchReasons evaluation={evaluation} stages={entry.stages} filters={filters} ix={ix} stageMode={stageMode} names={names} />;

  if (!visibleInResults && !evaluation.matches) {
    return (
      <section className="flex flex-col gap-1" aria-label={t('explain.noLonger')}>
        <p className="text-sm font-semibold">{t('explain.noLonger')}</p>
        {reasons}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-1" aria-label={t('explain.title')}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--draft-ink-2)]">{t('explain.title')}</h3>
      {reasons}
    </section>
  );
}
