'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { PointBuyListEntry } from '@/types/point-buy';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { FOCUS_RING, TABLE_HEAD } from '@/components/world/panel';
import { useDataLocale, useT } from '@/i18n/client';
import { worldClientMessages } from '@/i18n/messages/world/client';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import {
  displayPriceGroup,
  filterAndSortRosterEntries,
  priceGroupLineCounts,
  type PriceGroupFilter,
  type RosterSortKey,
} from '@/lib/evolution/point-buy-display';
import PriceGroupBar from './PriceGroupBar';
import { PRICE_GROUP_CHIP } from './price-group-chip';

interface RosterTableProps {
  entries: PointBuyListEntry[];
}

/** Sort options in display order, with their `world/client` label keys. */
const SORT_KEYS = {
  line: 'rosterTable.sort.line',
  'price-asc': 'rosterTable.sort.priceAsc',
  'price-desc': 'rosterTable.sort.priceDesc',
  kills: 'rosterTable.sort.kills',
} as const satisfies Record<RosterSortKey, string>;

const CONTROL_CLASS =
  'rounded-lg border border-arena-border bg-arena-elevated px-3 py-1.5 text-sm text-arena-ink ' +
  'placeholder:text-arena-ink-secondary focus:border-arena-accent focus:outline-none ' +
  FOCUS_RING;

/**
 * In-section point-buy roster with local-state filter/sort, in the viewer's
 * language; the search matches English and German species names alike. The
 * price-group filter is the `PriceGroupBar` pills directly under the controls,
 * so the rows and the "N / total lines" count it changes stay in view; the
 * rows themselves come from the pure `filterAndSortRosterEntries`.
 * Rows open the LineOverlay via the `?mon=<line id>` search param — the URL
 * stays shareable and the overlay content comes from page-loaded data.
 *
 * The header is sticky within the scroll container because this table runs to
 * ~100 rows; losing the column labels halfway down a price comparison is the
 * difference between a table and a wall of numbers.
 */
export default function RosterTable({ entries }: RosterTableProps) {
  const [search, setSearch] = useState('');
  const [priceGroup, setPriceGroup] = useState<PriceGroupFilter>('');
  const [sortKey, setSortKey] = useState<RosterSortKey>('line');
  const t = useT(worldClientMessages);
  const dataLocale = useDataLocale();
  const species = (name: string) => localizeSpecies(name, dataLocale);

  const filtered = useMemo(
    () => filterAndSortRosterEntries(entries, { search, priceGroup, sortKey }),
    [entries, search, priceGroup, sortKey],
  );
  const priceGroupCounts = useMemo(() => priceGroupLineCounts(entries), [entries]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder={t('rosterTable.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('rosterTable.searchLabel')}
          className={`min-w-[12rem] flex-1 ${CONTROL_CLASS}`}
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as RosterSortKey)}
          aria-label={t('rosterTable.sortLabel')}
          className={CONTROL_CLASS}
        >
          {(Object.keys(SORT_KEYS) as RosterSortKey[]).map((key) => (
            <option key={key} value={key}>
              {t(SORT_KEYS[key])}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-arena-ink-secondary" aria-live="polite">
          {t('rosterTable.count', { shown: filtered.length, total: entries.length })}
        </span>
      </div>

      <PriceGroupBar selected={priceGroup} onSelect={setPriceGroup} counts={priceGroupCounts} />

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-arena-border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10">
            <tr className={TABLE_HEAD}>
              <th className="bg-arena-elevated px-3 py-2">#</th>
              <th className="bg-arena-elevated px-3 py-2">{t('rosterTable.columns.pokemon')}</th>
              <th className="bg-arena-elevated px-3 py-2 text-center">{t('rosterTable.columns.price')}</th>
              <th className="bg-arena-elevated px-3 py-2 text-center">{t('rosterTable.columns.killsStage2')}</th>
              <th className="bg-arena-elevated px-3 py-2 text-center">{t('rosterTable.columns.killsStage3')}</th>
              <th className="bg-arena-elevated px-3 py-2 text-center">{t('rosterTable.columns.early')}</th>
              <th className="bg-arena-elevated px-3 py-2 text-center">{t('rosterTable.columns.mid')}</th>
              <th className="bg-arena-elevated px-3 py-2 text-center">{t('rosterTable.columns.late')}</th>
              <th className="bg-arena-elevated px-3 py-2">{t('rosterTable.columns.group')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr
                key={entry.id}
                data-roster-line={entry.id}
                className="border-b border-arena-border transition-colors duration-150 last:border-b-0 hover:bg-arena-elevated motion-reduce:transition-none"
              >
                <td className="px-3 py-2 text-arena-ink-secondary">{entry.line_number}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`?mon=${entry.id}`}
                    className={`flex items-center gap-2 ${FOCUS_RING}`}
                    aria-label={t('rosterTable.openLine', { name: species(entry.base_pokemon) })}
                  >
                    <PokemonSprite name={entry.base_pokemon} size={32} />
                    <span className="min-w-0">
                      <span className="font-medium text-arena-ink underline-offset-2 hover:underline">
                        {species(entry.base_pokemon)}
                      </span>
                      <span className="ml-1 text-xs text-arena-ink-secondary">
                        → {species(entry.stage2_pokemon)}
                        {entry.stage3_pokemon && ` → ${species(entry.stage3_pokemon)}`}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-center font-semibold text-arena-ink">{entry.price}</td>
                <td className="px-3 py-2 text-center text-arena-ink-secondary">{entry.kills_to_stage2}</td>
                <td className="px-3 py-2 text-center text-arena-ink-secondary">
                  {entry.additional_kills_to_stage3 ?? '—'}
                </td>
                <td className="px-3 py-2 text-center text-arena-ink-secondary">{entry.early_rating ?? '—'}</td>
                <td className="px-3 py-2 text-center text-arena-ink-secondary">{entry.mid_rating ?? '—'}</td>
                <td className="px-3 py-2 text-center text-arena-ink-secondary">{entry.late_rating ?? '—'}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${PRICE_GROUP_CHIP[displayPriceGroup(entry.price_group)]}`}
                  >
                    {t(`rosterTable.priceGroup.${displayPriceGroup(entry.price_group)}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="mt-3 text-sm text-arena-ink-secondary">{t('rosterTable.empty')}</p>
      )}
    </div>
  );
}
