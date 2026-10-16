'use client';

/**
 * Hover details of a roster card (draft-frontend §5.5 `HoverDetails`, SPEC:381-389): once the caller's
 * hover intent (`useHoverIntent`) settles, a small non-modal popover beside the card with
 * - why the line matches the active filters (each criterion ✓/✕ with the move, ability, type or stat that
 *   satisfied it and its first stage, then "All at once – from Stage N" or "Not all on the same Pokémon");
 * - the line's special rule (`lang` set when it is not in the UI language);
 * - the concrete utility matches (category, move/ability, stage).
 * It holds nothing core (no price, thresholds or draft action: SPEC:381-389) and never takes focus.
 *
 * `HoverDetailsContent` is the presentational body (renderable with `renderToStaticMarkup`).
 */
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useLocale } from '@/i18n/client';
import type { LineId, UtilityKey } from '@/types/draft-queue';
import { UTILITY_ORDER } from '@/lib/draft/utility-categories';
import type { CriterionResult, LineEvaluation } from '@/lib/draft-finder/engine';
import type { FinderFilters, StageMode } from '@/lib/draft-finder/filter-types';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import { cn } from '@/lib/utils/cn';
import { criterionLabel, resultText, useFinderLabelContext, utilityLabel, viaText } from './finder-labels';

export interface HoverDetailsContentProps {
  evaluation: LineEvaluation | null;
  entry: DraftLineCatalogEntry;
  /** Satisfied utility criteria (default: taken from `evaluation`). */
  utilityMatches?: CriterionResult[];
  filters: FinderFilters;
  ix: PreparedIndex | null;
  stageMode: StageMode;
  names?: NameResolver;
}

export interface HoverDetailsProps extends Omit<HoverDetailsContentProps, 'entry'> {
  lineId: LineId | null;
  anchor: HTMLElement | null;
  entry: DraftLineCatalogEntry | null;
}

const UTILITY_PREFIX = 'utility:';

function isUtilityKey(value: string): value is UtilityKey {
  return (UTILITY_ORDER as readonly string[]).includes(value);
}

/** The satisfied utility results of an evaluation, in result order. Pure. */
export function utilityResults(evaluation: LineEvaluation | null): CriterionResult[] {
  return (evaluation?.results ?? []).filter((r) => r.criterionId.startsWith(UTILITY_PREFIX) && r.satisfied);
}

/** Whether the popover has anything to say (active criteria or a special rule). Pure. */
export function hasHoverDetails(evaluation: LineEvaluation | null, entry: DraftLineCatalogEntry | null): boolean {
  if (!entry) return false;
  return (evaluation?.results.length ?? 0) > 0 || entry.specialRules !== null;
}

export function HoverDetailsContent({
  evaluation,
  entry,
  utilityMatches,
  filters,
  ix,
  stageMode,
  names,
}: HoverDetailsContentProps) {
  const ctx = useFinderLabelContext(names);
  const uiLocale = useLocale();
  const { t } = ctx;
  const results = evaluation?.results ?? [];
  const utility = utilityMatches ?? utilityResults(evaluation);
  const rules = entry.specialRules;
  // With several criteria: from which stage they all hold at once, or that they never do (anywhere mode).
  const together =
    results.length < 2
      ? null
      : evaluation?.simultaneousFromStage
        ? t('hover.allAtOnce', { stage: evaluation.simultaneousFromStage })
        : stageMode === 'anywhere' && evaluation?.matches
          ? t('hover.notTogether')
          : null;

  return (
    <div className="flex flex-col gap-2 p-3 text-sm text-[var(--draft-ink,var(--poke-text-primary))]">
      {results.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--draft-ink-2,var(--poke-text-secondary))]">
            {t('hover.title')}
          </p>
          <ul className="flex flex-col gap-0.5">
            {results.map((r) => {
              const criterion = criterionLabel(r.criterionId, filters, ix, ctx);
              const detail = resultText(r, ix, ctx);
              return (
                <li key={r.criterionId} className={cn(!r.satisfied && 'text-[var(--draft-ink-2,var(--poke-text-secondary))]')}>
                  <span className="font-semibold">
                    {r.satisfied ? t('hover.met', { criterion }) : t('hover.missed', { criterion })}
                  </span>
                  {detail && <span> – {detail}</span>}
                </li>
              );
            })}
          </ul>
          {together && <p className="mt-1 text-xs">{together}</p>}
        </div>
      )}

      {utility.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--draft-ink-2,var(--poke-text-secondary))]">
            {t('hover.utilityTitle')}
          </p>
          <ul className="flex flex-col gap-0.5">
            {utility.map((r) => {
              const key = r.criterionId.slice(UTILITY_PREFIX.length);
              const what = r.via ? viaText(r.via, ix, ctx) : '';
              if (!isUtilityKey(key) || !what || r.firstStage === null) return null;
              return (
                <li key={r.criterionId}>
                  {t('hover.utilityMatch', { category: utilityLabel(key, ctx), what, stage: r.firstStage })}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {rules && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--draft-ink-2,var(--poke-text-secondary))]">
            {t('hover.specialRule')}
          </p>
          <p lang={rules.lang !== uiLocale ? rules.lang : undefined} className="whitespace-pre-line">
            {rules.text}
          </p>
        </div>
      )}
    </div>
  );
}

export default function HoverDetails({ lineId, anchor, entry, ...content }: HoverDetailsProps) {
  // The caller owns the hover-intent delay (`useHoverIntent`): a non-null `lineId` shows at once.
  const visible = lineId !== null && anchor !== null && hasHoverDetails(content.evaluation, entry);
  if (!visible || !entry) return null;

  return (
    <PopoverPrimitive.Root open modal={false}>
      <PopoverPrimitive.Anchor virtualRef={{ current: anchor }} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="left"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="pointer-events-none z-[9998] max-w-xs rounded-poke-lg border border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-glass,var(--poke-surface))] shadow-poke-lg backdrop-blur"
        >
          <HoverDetailsContent entry={entry} {...content} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
