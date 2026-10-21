'use client';

/**
 * Bilingual search-and-pick list for moves and abilities (draft-frontend §5.5 `FilterPanel`: "combobox over
 * `ix.moveSearch`"). The query uses the finder's word-prefix search over EN + DE + transliterated keys
 * (`stageMatchesText`, §4.3), so "Tarnsteine", "tarnst" and "Stealth Rock" all find Stealth Rock. Picked
 * entries show as removable pills; matches are toggle buttons. The query is controlled: it lives in the
 * finder view state (`filterSheet.pickerQuery`), so it survives closing the filter sheet.
 */
import { useId, useMemo } from 'react';
import { useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import { foldQuery, isEmptyQuery, stageMatchesText } from '@/lib/draft-finder/search';
import type { SearchKeys } from '@/lib/pkmn/i18n/search';
import { cn } from '@/lib/utils/cn';
import { FOCUS_RING, pillClass } from './types';

export interface PickerEntry {
  /** @pkmn id */
  id: string;
  /** Display name in the data locale. */
  name: string;
  keys: SearchKeys;
}

export interface SearchPickerProps {
  entries: readonly PickerEntry[];
  selected: readonly string[];
  onToggle(id: string): void;
  /** The typed query (controlled). */
  query: string;
  onQueryChange(query: string): void;
  searchLabel: string;
  names: NameResolver;
  dl: Locale;
  /** Matches shown at once. */
  limit?: number;
}

export const PICKER_LIMIT = 12;

/** The entries a query finds, sorted by display name in the data locale. Pure. */
export function pickerMatches(
  entries: readonly PickerEntry[],
  query: string,
  compare: (a: string, b: string) => number,
): PickerEntry[] {
  const q = foldQuery(query);
  if (isEmptyQuery(q)) return [];
  return entries.filter((e) => stageMatchesText(e.keys, q)).sort((a, b) => compare(a.name, b.name));
}

export default function SearchPicker({
  entries,
  selected,
  onToggle,
  query,
  onQueryChange,
  searchLabel,
  names,
  dl,
  limit = PICKER_LIMIT,
}: SearchPickerProps) {
  const t = useT(draftFinderMessages);
  const listId = useId();
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const matches = useMemo(
    () => pickerMatches(entries, query, (a, b) => names.compare(a, b, dl)),
    [entries, query, names, dl],
  );
  const shown = matches.slice(0, limit);
  const more = matches.length - shown.length;

  return (
    <div>
      {selected.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={t('picker.selected')}>
          {selected.map((id) => {
            const name = byId.get(id)?.name ?? id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onToggle(id)}
                  aria-label={t('picker.remove', { name })}
                  className={pillClass(true)}
                >
                  <span>{name}</span>
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        aria-label={searchLabel}
        placeholder={searchLabel}
        aria-controls={listId}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          'w-full rounded-poke-md border border-[var(--draft-border,var(--poke-border))] bg-[var(--draft-surface,var(--poke-surface))] px-2.5 py-1.5 text-sm text-[var(--draft-ink,var(--poke-text-primary))] placeholder:text-poke-text-muted',
          FOCUS_RING,
        )}
      />
      <div id={listId} role="group" aria-label={searchLabel} className="mt-1.5 flex flex-wrap gap-1.5">
        {query.trim() !== '' && shown.length === 0 && (
          <p className="text-xs text-[var(--draft-ink-2,var(--poke-text-secondary))]">{t('picker.noResults')}</p>
        )}
        {shown.map((e) => {
          const pressed = selected.includes(e.id);
          return (
            <button key={e.id} type="button" aria-pressed={pressed} onClick={() => onToggle(e.id)} className={pillClass(pressed)}>
              {e.name}
            </button>
          );
        })}
        {more > 0 && (
          <p className="w-full text-xs text-[var(--draft-ink-2,var(--poke-text-secondary))]">
            {t('picker.moreResults', { count: more })}
          </p>
        )}
      </div>
    </div>
  );
}
