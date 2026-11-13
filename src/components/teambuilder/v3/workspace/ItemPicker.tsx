'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import ItemSprite from '@/components/shared/ItemSprite';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { itemSearchKeys, localizeItem } from '@/lib/pkmn/i18n/names/items';
import { compareDisplayNames, foldForSearch, matchRank, NO_MATCH } from '@/lib/pkmn/i18n/search';
import { useEditorContext } from '../editor/EditorContext';
import { useUsageDetail } from '../hooks/useUsageDetail';
import DescFallbackTag from './DescFallbackTag';
import { formatUsagePct } from './usagePercent';

interface ItemEntry {
  /** Canonical English name: the value passed to `onSelect`. */
  name: string;
  desc: string;
  /** 'en' when a German UI asked for German text and none exists (pkmn-l10n §3.6). */
  descLang?: Locale;
}

type SortField = 'name' | 'usage';
type SortDir = 'asc' | 'desc';

interface ItemPickerProps {
  species: string;
  currentItem: string;
  onSelect: (item: string) => void;
  onClose: () => void;
}

// Module-level cache per gen:lang (full item list; descriptions follow the UI language)
const itemCache = new Map<string, ItemEntry[]>();

/**
 * ItemPicker — full panel shown when the item field is clicked.
 *
 * Lists every held item with sprite, description, and usage% on this species
 * for the current meta. Searchable and sortable by name or usage; usage-sorted
 * by default so the most common picks lead.
 */
export default function ItemPicker({ species, currentItem, onSelect, onClose }: ItemPickerProps) {
  const { state } = useEditorContext();
  const usageDetail = useUsageDetail(species, state.format, state.seasonId);
  const generation = state.generation;
  const t = useT(teambuilderIntelMessages);
  const locale = useLocale();
  const dl = useDataLocale();
  const cacheKey = `${generation}:${locale}`;

  const [query, setQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('usage');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [allItems, setAllItems] = useState<ItemEntry[]>(() => itemCache.get(cacheKey) ?? []);
  const [loading, setLoading] = useState<boolean>(() => !itemCache.has(cacheKey));
  const [trackedKey, setTrackedKey] = useState(cacheKey);

  // Adjust cached items during render on gen/language change (avoids setState in effect body)
  if (cacheKey !== trackedKey) {
    setTrackedKey(cacheKey);
    setAllItems(itemCache.get(cacheKey) ?? []);
    setLoading(!itemCache.has(cacheKey));
  }

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch and cache full item list for this gen and UI language
  useEffect(() => {
    const key = `${generation}:${locale}`;
    if (itemCache.has(key)) return;
    const controller = new AbortController();
    fetch(`/api/pkmn/items?gen=${generation}&lang=${locale}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          const items = j.data as ItemEntry[];
          itemCache.set(key, items);
          setAllItems(items);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [generation, locale]);

  const itemUsage = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const [name, pct] of Object.entries(usageDetail?.items ?? {})) {
      map[name.toLowerCase()] = pct;
    }
    return map;
  }, [usageDetail]);

  const displayResults = useMemo(() => {
    let items = allItems;

    if (query.trim()) {
      // Names match in English and German whatever the locale; the description in the shown language.
      const q = foldForSearch(query);
      items = items.filter(
        (i) =>
          matchRank(query, itemSearchKeys(i.name)) !== NO_MATCH ||
          (q !== '' && foldForSearch(i.desc).includes(q)),
      );
    }

    // Sort by the displayed (localized) name
    const byName = (a: ItemEntry, b: ItemEntry) =>
      compareDisplayNames(localizeItem(a.name, dl), localizeItem(b.name, dl), dl);

    return [...items].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = byName(a, b);
      } else {
        cmp = (itemUsage[a.name.toLowerCase()] ?? -1) - (itemUsage[b.name.toLowerCase()] ?? -1);
        // Tie-break alphabetically so the no-usage tail stays scannable
        if (cmp === 0) cmp = -byName(a, b);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [allItems, query, sortField, sortDir, itemUsage, dl]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  };

  const sortArrow = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? <ArrowUp aria-hidden="true" className="ml-0.5 inline size-3" /> : <ArrowDown aria-hidden="true" className="ml-0.5 inline size-3" />;
  };

  return (
    <div className="flex flex-col border border-hairline rounded-lg overflow-hidden bg-elevated">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-hairline bg-surface">
        <h4 className="text-xs font-semibold text-fg">{t('itemPicker.title')}</h4>
        <div className="flex items-center gap-3">
          {currentItem && (
            <button
              type="button"
              className="text-xs text-loss hover:text-loss transition-colors"
              onClick={() => onSelect('')}
            >
              {t('itemPicker.clear')}
            </button>
          )}
          <button
            type="button"
            className="text-xs text-fg-muted hover:text-fg transition-colors"
            onClick={onClose}
          >
            {t('common.done')}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-hairline">
        <input
          ref={inputRef}
          type="text"
          className="w-full bg-surface border border-hairline rounded px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-muted focus:ring-1 transition-all outline-2 outline-offset-2 outline-transparent pointer-coarse:text-base pointer-coarse:min-h-11"
          placeholder={t('itemPicker.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && displayResults.length > 0) {
              onSelect(displayResults[0].name);
            }
          }}
        />
      </div>

      {/* Sort controls aligned to result columns */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-hairline text-caption text-fg-muted">
        <span className="w-5 shrink-0" aria-hidden="true" />
        <button
          type="button"
          className={`min-w-[5rem] text-left rounded px-1 py-0.5 transition-colors ${
            sortField === 'name'
              ? 'bg-accent-subtle text-accent-ink font-semibold'
              : 'hover:text-fg'
          }`}
          onClick={() => handleSort('name')}
        >
          {t('common.name')}{sortArrow('name')}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className={`w-11 rounded px-0.5 py-0.5 text-right transition-colors ${
            sortField === 'usage'
              ? 'bg-accent-subtle text-accent-ink font-semibold'
              : 'hover:text-fg'
          }`}
          onClick={() => handleSort('usage')}
        >
          {t('common.usePct')}{sortArrow('usage')}
        </button>
      </div>

      {/* Results list */}
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-center text-xs text-fg-muted">{t('itemPicker.loading')}</div>
        ) : displayResults.length === 0 ? (
          <div className="p-3 text-center text-xs text-fg-muted">{t('itemPicker.empty')}</div>
        ) : (
          displayResults.map((item) => {
            const isCurrent = item.name === currentItem;
            const pct = itemUsage[item.name.toLowerCase()];
            const displayName = localizeItem(item.name, dl);

            return (
              <button
                key={item.name}
                type="button"
                className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-left transition-colors ${
                  isCurrent ? 'bg-accent-subtle' : 'hover:bg-hover'
                }`}
                onClick={() => onSelect(item.name)}
                title={item.desc || displayName}
              >
                <ItemSprite item={item.name} size={20} className="shrink-0" />
                <span className="text-xs text-fg shrink-0">
                  {displayName}
                  {isCurrent && <Check aria-hidden="true" className="ml-1 inline size-3.5 text-accent-ink" />}
                </span>
                {item.desc ? (
                  <span className="text-caption text-fg-muted flex-1 truncate ml-1 hidden sm:inline">
                    {item.desc}
                    <DescFallbackTag descLang={item.descLang} />
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
                <span className="sm:hidden flex-1" />
                <span
                  className="text-caption shrink-0 w-11 text-right tabular-nums text-fg-muted"
                  title={t('itemPicker.usageTitle')}
                >
                  {pct !== undefined ? formatUsagePct(pct, locale) : ''}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
