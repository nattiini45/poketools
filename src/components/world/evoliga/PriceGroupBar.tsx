'use client';

import { useId } from 'react';
import { FOCUS_RING } from '@/components/world/panel';
import { useT } from '@/i18n/client';
import { worldClientMessages } from '@/i18n/messages/world/client';
import { priceGroupMatches, togglePriceGroup, type PriceGroupFilter } from '@/lib/evolution/point-buy-display';
import type { PriceGroup } from '@/types/point-buy';
import { PRICE_GROUP_CHIP } from './price-group-chip';

interface PriceGroupBarProps {
  /** The active filter: a canonical group key, or `''` for every group. */
  selected: PriceGroupFilter;
  onSelect: (next: PriceGroupFilter) => void;
  /** Lines per displayed group, one entry per pill in ladder order (`priceGroupLineCounts`). */
  counts: readonly { group: PriceGroup; count: number }[];
}

/** Shared by every pill, "All" included: the ladder colour (`PRICE_GROUP_CHIP`, which brings the border) is added per group. */
const PILL =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors duration-150 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ' +
  FOCUS_RING;

const PILL_IDLE = 'font-semibold enabled:hover:ring-1 enabled:hover:ring-arena-ink-secondary';

/**
 * Selected = an ink ring set off from the surface plus bold type (`aria-pressed` carries the
 * semantics), so the state never rides on the ladder colour alone and the pill keeps the group's
 * own AA text pair.
 */
const PILL_PRESSED = 'font-bold ring-2 ring-arena-ink ring-offset-2 ring-offset-arena-surface';

/** The neutral "all price groups" pill, drawn as the mid step of the ladder. */
const PILL_ALL = PRICE_GROUP_CHIP.mittel;

/**
 * The #roster price-group filter as a row of toggle pills: "All" first, then one pill per distinct
 * label (`priceGroupFilterOptions`) in ladder colours, each with its line count. A controlled
 * component: the table owns the filter (`selected`), a click on the active pill clears it, and a
 * group without lines is disabled unless it is the selected one (so a filter can always be undone).
 */
export default function PriceGroupBar({ selected, onSelect, counts }: PriceGroupBarProps) {
  const t = useT(worldClientMessages);
  const headingId = useId();
  const total = counts.reduce((sum, { count }) => sum + count, 0);

  return (
    <div className="mb-3">
      <h3
        id={headingId}
        className="mb-1.5 font-heading text-xs font-semibold uppercase tracking-wide text-arena-ink-secondary"
      >
        {t('rosterTable.priceGroups')}
      </h3>
      <div role="group" aria-labelledby={headingId} className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={selected === ''}
          aria-label={t('rosterTable.priceGroupPill', { label: t('rosterTable.allPriceGroups'), count: total })}
          onClick={() => onSelect('')}
          className={`${PILL} ${PILL_ALL} ${selected === '' ? PILL_PRESSED : PILL_IDLE}`}
        >
          {t('rosterTable.allPriceGroups')} <span className="tabular-nums">{total}</span>
        </button>
        {counts.map(({ group, count }) => {
          const label = t(`rosterTable.priceGroup.${group}`);
          const pressed = selected !== '' && priceGroupMatches(selected, group);
          return (
            <button
              key={group}
              type="button"
              data-price-group={group}
              aria-pressed={pressed}
              aria-label={t('rosterTable.priceGroupPill', { label, count })}
              disabled={count === 0 && !pressed}
              onClick={() => onSelect(togglePriceGroup(selected, group))}
              className={`${PILL} ${PRICE_GROUP_CHIP[group]} ${pressed ? PILL_PRESSED : PILL_IDLE}`}
            >
              {label} <span className="tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
