'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useDataLocale, useT } from '@/i18n/client';
import { rulesetStudioPickerMessages } from '@/i18n/messages/ruleset-studio/picker';
import type { CatalogEntry } from '@/lib/pkmn/catalog-index';
import { isLegalState, type EntryState } from '@/lib/ruleset-kit/entry-state';
import type { RulesetCategory } from '@/lib/ruleset-kit/types';
import { pageBounds, pageCount } from '@/lib/ruleset-studio/editor/picker/layout';
import type { SelectionState } from '@/lib/ruleset-studio/editor/picker/selection';
import { displayName } from '@/lib/ruleset-studio/editor/picker/display';
import StateChip from './StateChip';

interface EntryTableProps {
  category: RulesetCategory;
  entries: readonly CatalogEntry[];
  stateOf: (id: string) => EntryState;
  descriptions: Readonly<Record<string, string>> | null;
  tagOf: (entry: CatalogEntry) => string;
  selection: SelectionState;
  page: number;
  onPage: (page: number) => void;
  onToggleSelected: (id: string) => void;
  onSelectPage: (ids: readonly string[], selected: boolean) => void;
  onAct: (id: string) => void;
  allowlist: boolean;
}

/**
 * The plain table: native checkboxes and buttons, no virtualization, no listbox role, fifty rows a page. It is the
 * accessible fallback of the picker and the default when the viewer asks for reduced motion or more contrast. Every row
 * has the same actions as a card, as real buttons that screen readers and switch controls handle without the listbox
 * keyboard model.
 */
export default function EntryTable({
  category,
  entries,
  stateOf,
  descriptions,
  tagOf,
  selection,
  page,
  onPage,
  onToggleSelected,
  onSelectPage,
  onAct,
  allowlist,
}: EntryTableProps) {
  const t = useT(rulesetStudioPickerMessages);
  const dataLocale = useDataLocale();
  const bounds = pageBounds(entries.length, page);
  const rows = entries.slice(bounds.start, bounds.end);
  const allOnPage = rows.length > 0 && rows.every((entry) => selection.ids.has(entry.id));

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-poke-md border border-poke-border bg-poke-surface">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
          <caption className="sr-only">{t(`table.caption.${category}`)}</caption>
          <thead className="bg-poke-muted text-xs text-poke-text-secondary">
            <tr>
              <th scope="col" className="w-10 p-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-poke-accent"
                  checked={allOnPage}
                  aria-label={t('table.selectAllPage')}
                  onChange={(event) => onSelectPage(rows.map((entry) => entry.id), event.target.checked)}
                />
              </th>
              <th scope="col" className="p-2 font-semibold">{t('table.name')}</th>
              <th scope="col" className="p-2 font-semibold">{t('table.info')}</th>
              <th scope="col" className="p-2 font-semibold">{t('table.state')}</th>
              <th scope="col" className="p-2 font-semibold">{t('table.action')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              const state = stateOf(entry.id);
              const legal = isLegalState(state);
              const name = displayName(entry, dataLocale);
              const actionLabel = allowlist ? (legal ? t('action.disallow', { name }) : t('action.allow', { name })) : legal ? t('action.ban', { name }) : t('action.unban', { name });
              return (
                <tr key={entry.id} className="border-t border-poke-border align-top">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-poke-accent"
                      checked={selection.ids.has(entry.id)}
                      aria-label={t('card.select', { name })}
                      onChange={() => onToggleSelected(entry.id)}
                    />
                  </td>
                  <th scope="row" className="p-2 font-heading font-semibold text-poke-text-primary">{name}</th>
                  <td className="p-2 text-xs text-poke-text-secondary">
                    <span className="block">{tagOf(entry)}</span>
                    {descriptions?.[entry.id] !== undefined && <span className="block max-w-prose">{descriptions[entry.id]}</span>}
                  </td>
                  <td className="p-2">
                    <StateChip state={state} label={t(`state.${state}`)} />
                  </td>
                  <td className="p-2">
                    <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" aria-label={actionLabel} onClick={() => onAct(entry.id)}>
                      {allowlist ? (legal ? t('action.disallowShort') : t('action.allowShort')) : legal ? t('action.banShort') : t('action.unbanShort')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <nav className="flex items-center justify-between gap-2" aria-label={t(`table.caption.${category}`)}>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" disabled={bounds.page <= 1} onClick={() => onPage(bounds.page - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {t('table.previous')}
        </Button>
        <span className="text-sm text-poke-text-secondary" aria-live="polite">
          {t('table.page', { page: bounds.page, pages: pageCount(entries.length) })}
        </span>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-0" disabled={bounds.page >= pageCount(entries.length)} onClick={() => onPage(bounds.page + 1)}>
          {t('table.next')}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </nav>
    </div>
  );
}
