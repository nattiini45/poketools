'use client';

/**
 * Price tabs pinned on top of the wall (draft-frontend §5.5 `PriceTabs`, FR-8, SPEC:84-90): one parallelogram
 * pill per price range of the active format pack (`epb.priceTabs`, rendered `max–min` with an en dash) plus
 * "All". Each shows its count, `matching/total` while filters are active. Counts come from the finder (always
 * derived from data, SPEC:47). Switching tabs only sets `view.tab`: filters and the pinned line stay
 * (SPEC:196-199, the reducer invariant).
 *
 * Placement is the screen's job (`.wallTabs`): directly under the finder bar and the chip row, outside the
 * scrolling grid, sticky under the site nav where the page scrolls, so the tabs are always visible.
 *
 * Phones scroll the strip sideways (one row under the sticky clock row); from 768 px it wraps, so every tab
 * stays visible at tablet and narrow desktop widths even with `matching/total` badges (gate W1: five tabs need
 * about 520 px, the wall is about 360-580 px wide there), with compact padding.
 *
 * `role="tablist"` with automatic activation: Left/Right/Home/End move and select.
 */
import { useRef, type KeyboardEvent } from 'react';
import { useFormatter, useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { FinderResult } from '@/lib/draft-finder/engine';
import { PRICE_TAB_KEYS, PRICE_TABS, type PriceTabKey } from '@/lib/draft-finder/tabs';
import { priceTabIndex } from '@/lib/draft/price-tabs';
import { cn } from '@/lib/utils/cn';

export interface PriceTabsProps {
  active: PriceTabKey;
  counts: FinderResult['tabCounts'];
  filtersActive: boolean;
  onSelect(tab: PriceTabKey): void;
  /** The id of the wall the tabs control. */
  controlsId?: string;
  className?: string;
}

/**
 * Token per tab position (§5.4 `--draft-tab-1..n`, highest price first), with a palette-aware fallback.
 * Keyed by the tab's index in `PRICE_TABS` because tab keys come from the format pack. Static strings
 * for Tailwind; a pack may define up to six tabs.
 */
const TAB_FILL_BY_INDEX: readonly string[] = [
  'bg-[var(--draft-tab-1,var(--poke-yellow-light))]',
  'bg-[var(--draft-tab-2,var(--poke-accent-light))]',
  'bg-[var(--draft-tab-3,var(--poke-elevated))]',
  'bg-[var(--draft-tab-4,var(--poke-green-light))]',
  'bg-[var(--draft-tab-5,var(--poke-elevated))]',
  'bg-[var(--draft-tab-6,var(--poke-elevated))]',
];
const TAB_FILL_ALL = 'bg-[var(--draft-tab-all,var(--poke-elevated))]';

function tabFill(key: PriceTabKey): string {
  const index = priceTabIndex(key);
  return index >= 0 ? (TAB_FILL_BY_INDEX[index] ?? TAB_FILL_ALL) : TAB_FILL_ALL;
}

export default function PriceTabs({ active, counts, filtersActive, onSelect, controlsId, className }: PriceTabsProps) {
  const t = useT(draftFinderMessages);
  const tg = useT(glossaryMessages);
  const format = useFormatter();
  const refs = useRef(new Map<PriceTabKey, HTMLButtonElement>());

  const rangeOf = (key: PriceTabKey): string => {
    const tab = PRICE_TABS.find((p) => p.key === key);
    return tab ? t('tabs.range', { max: tab.max, min: tab.min }) : tg('state.all');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = PRICE_TAB_KEYS.indexOf(active);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % PRICE_TAB_KEYS.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + PRICE_TAB_KEYS.length) % PRICE_TAB_KEYS.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = PRICE_TAB_KEYS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const key = PRICE_TAB_KEYS[next];
    onSelect(key);
    refs.current.get(key)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t('tabs.label')}
      onKeyDown={handleKeyDown}
      className={cn('flex gap-1.5 overflow-x-auto px-3 py-2 md:flex-wrap md:overflow-x-visible', className)}
    >
      {PRICE_TAB_KEYS.map((key) => {
        const count = counts[key];
        const selected = key === active;
        const range = rangeOf(key);
        const badge = filtersActive
          ? t('tabs.matchingOfTotal', { matching: count.matching, total: count.total })
          : format.number(count.total);
        return (
          <button
            key={key}
            ref={(el) => {
              if (el) refs.current.set(key, el);
              else refs.current.delete(key);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={controlsId}
            aria-label={t('tabs.tabAria', { range, count: filtersActive ? count.matching : count.total })}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(key)}
            className={cn(
              // 44 px touch target on phones (the tabs scroll sideways there); compact from 768 px.
              'min-h-[44px] shrink-0 -skew-x-12 rounded-sm border px-3 py-1.5 text-sm font-semibold md:min-h-0 md:px-2.5 md:py-1',
              'text-[var(--draft-tab-ink,var(--poke-text-primary))]',
              'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--poke-focus)]',
              tabFill(key),
              selected
                ? 'border-2 border-[var(--draft-accent,var(--poke-accent))]'
                : 'border-[var(--draft-border,var(--poke-border))]',
            )}
          >
            <span className="inline-flex skew-x-12 items-center gap-1.5 whitespace-nowrap">
              <span>{range}</span>
              <span
                className="rounded-full bg-[var(--draft-surface,var(--poke-surface))] px-1.5 text-xs tabular-nums"
                aria-hidden="true"
              >
                {badge}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
