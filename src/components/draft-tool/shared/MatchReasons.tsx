'use client';

/**
 * Why a line matches the active filters: one row per criterion ("Recovery ✓ – Regenerator, from Incineroar",
 * "Spikes ✕"), then "All at once – from Incineroar" or "Not all on the same Pokémon" under several criteria.
 *
 * The one implementation behind the roster card's hover popover (`HoverDetails`) and the pinned line's panel
 * (`MatchExplanation`), so both read the same. All text comes from `right/finder-labels.ts`; the callers add
 * their own heading and framing. Renders nothing for a line without evaluated criteria.
 */
import type { LineEvaluation } from '@/lib/draft-finder/engine';
import type { FinderFilters, StageMode } from '@/lib/draft-finder/filter-types';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import { cn } from '@/lib/utils/cn';
import {
  criterionLabel,
  resultText,
  togetherText,
  useFinderLabelContext,
  type LineStages,
} from '../right/finder-labels';

export interface MatchReasonsProps {
  evaluation: LineEvaluation | null;
  /** The stages of the evaluated line (catalog entry), to name the Pokémon a result first holds on. */
  stages: LineStages;
  filters: FinderFilters;
  ix: PreparedIndex | null;
  stageMode: StageMode;
  names?: NameResolver;
}

export default function MatchReasons({ evaluation, stages, filters, ix, stageMode, names }: MatchReasonsProps) {
  const ctx = useFinderLabelContext(names);
  const { t } = ctx;
  if (!evaluation || evaluation.results.length === 0) return null;
  const together = togetherText(evaluation, stages, stageMode, ctx);

  return (
    <>
      <ul className="flex flex-col gap-0.5 text-sm">
        {evaluation.results.map((r) => {
          const criterion = criterionLabel(r.criterionId, filters, ix, ctx);
          const detail = resultText(r, stages, ix, ctx);
          return (
            <li key={r.criterionId} className={cn(!r.satisfied && 'text-[var(--draft-ink-2,var(--poke-text-secondary))]')}>
              <span className="font-semibold">{r.satisfied ? t('hover.met', { criterion }) : t('hover.missed', { criterion })}</span>
              {detail && <span> – {detail}</span>}
            </li>
          );
        })}
      </ul>
      {together && <p className="mt-1 text-xs">{together}</p>}
    </>
  );
}
