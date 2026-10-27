'use client';

/**
 * Hover details of a roster card (draft-frontend §5.5 `HoverDetails`, SPEC:381-389): once the caller's
 * hover intent (`useHoverIntent`) settles, a small non-modal popover beside the card with
 * - why the line matches the active filters: each criterion ✓/✕ on one row with the move, ability, type or
 *   stat that satisfied it and the Pokémon it first holds on ("Spikes, from Incineroar"), then "All at once –
 *   from Incineroar" or "Not all on the same Pokémon" (rendered by the shared `MatchReasons`, the same rows
 *   the pinned line's panel shows; a utility criterion is one row, there is no second utility list);
 * - the line's special rule (`lang` set when it is not in the UI language).
 * It holds nothing core (no price, thresholds or draft action: SPEC:381-389) and never takes focus.
 *
 * `HoverDetailsContent` is the presentational body (renderable with `renderToStaticMarkup`).
 */
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useLocale, useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import type { LineId } from '@/types/draft-queue';
import type { LineEvaluation } from '@/lib/draft-finder/engine';
import type { FinderFilters, StageMode } from '@/lib/draft-finder/filter-types';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import type { PreparedIndex } from '@/lib/draft-finder/prepare';
import MatchReasons from '../shared/MatchReasons';

export interface HoverDetailsContentProps {
  evaluation: LineEvaluation | null;
  entry: DraftLineCatalogEntry;
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

/** Whether the popover has anything to say (active criteria or a special rule). Pure. */
export function hasHoverDetails(evaluation: LineEvaluation | null, entry: DraftLineCatalogEntry | null): boolean {
  if (!entry) return false;
  return (evaluation?.results.length ?? 0) > 0 || entry.specialRules !== null;
}

const SECTION_TITLE = 'mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--draft-ink-2,var(--poke-text-secondary))]';

export function HoverDetailsContent({ evaluation, entry, filters, ix, stageMode, names }: HoverDetailsContentProps) {
  const t = useT(draftFinderMessages);
  const uiLocale = useLocale();
  const rules = entry.specialRules;

  return (
    <div className="flex flex-col gap-2 p-3 text-sm text-[var(--draft-ink,var(--poke-text-primary))]">
      {(evaluation?.results.length ?? 0) > 0 && (
        <div>
          <p className={SECTION_TITLE}>{t('hover.title')}</p>
          <MatchReasons evaluation={evaluation} stages={entry.stages} filters={filters} ix={ix} stageMode={stageMode} names={names} />
        </div>
      )}

      {rules && (
        <div>
          <p className={SECTION_TITLE}>{t('hover.specialRule')}</p>
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
