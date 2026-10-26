'use client';

import { Ban, LockOpen, Minus, Plus, RotateCcw, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { rulesetStudioPickerMessages } from '@/i18n/messages/ruleset-studio/picker';
import type { BulkAction, BulkScope } from '@/lib/ruleset-studio/editor/picker/bulk';

interface BulkBarProps {
  selectedCount: number;
  /** Selected entries the current filters hide. */
  hiddenCount: number;
  /** Entries the current search and filters show. */
  filteredCount: number;
  /** A search or a facet narrows the view: "apply to all N filtered" is offered. */
  narrowed: boolean;
  allowlist: boolean;
  onAct: (action: BulkAction, scope: BulkScope) => void;
  onClear: () => void;
  onSelectAll: () => void;
}

const BUTTON = 'min-h-11 sm:min-h-0';

/**
 * Bulk actions for the selection, and for everything the current search and filters show ("ban all 87 Fire types").
 * The bar sits under the list so it never covers an entry, and stays visible while the list scrolls inside its box.
 */
export default function BulkBar({ selectedCount, hiddenCount, filteredCount, narrowed, allowlist, onAct, onClear, onSelectAll }: BulkBarProps) {
  const t = useT(rulesetStudioPickerMessages);
  const hasSelection = selectedCount > 0;
  const hasFiltered = narrowed && filteredCount > 0;
  if (!hasSelection && !hasFiltered) return null;

  return (
    <section aria-label={t('bulk.heading')} className="space-y-2 rounded-poke-md border border-poke-accent/40 bg-poke-accent-light/60 p-3">
      {hasSelection && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-1 text-sm font-semibold text-poke-text-primary" role="status">
            {t('bulk.selected', { count: selectedCount })}
            {hiddenCount > 0 && <span className="ml-2 font-normal text-poke-text-secondary">{t('bulk.hidden', { count: hiddenCount })}</span>}
          </p>
          {allowlist ? (
            <>
              <Button type="button" variant="success" size="sm" className={BUTTON} onClick={() => onAct('allow', 'selection')}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t('bulk.allow')}
              </Button>
              <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={() => onAct('ban', 'selection')}>
                <Minus className="h-4 w-4" aria-hidden="true" />
                {t('bulk.disallow')}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="danger" size="sm" className={BUTTON} onClick={() => onAct('ban', 'selection')}>
                <Ban className="h-4 w-4" aria-hidden="true" />
                {t('bulk.ban')}
              </Button>
              <Button type="button" variant="success" size="sm" className={BUTTON} onClick={() => onAct('unban', 'selection')}>
                <LockOpen className="h-4 w-4" aria-hidden="true" />
                {t('bulk.unban')}
              </Button>
              <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={() => onAct('reset', 'selection')}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {t('bulk.reset')}
              </Button>
            </>
          )}
          <Button type="button" variant="ghost" size="sm" className={BUTTON} onClick={onClear}>
            <X className="h-4 w-4" aria-hidden="true" />
            {t('bulk.clear')}
          </Button>
        </div>
      )}
      {hasFiltered && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-1 text-sm font-semibold text-poke-text-primary">{t('bulk.filtered', { count: filteredCount })}</p>
          {allowlist ? (
            <>
              <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={() => onAct('allow', 'filtered')}>
                {t('bulk.allowFiltered')}
              </Button>
              <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={() => onAct('ban', 'filtered')}>
                {t('bulk.disallowFiltered')}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={() => onAct('ban', 'filtered')}>
                {t('bulk.banFiltered')}
              </Button>
              <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={() => onAct('unban', 'filtered')}>
                {t('bulk.unbanFiltered')}
              </Button>
              <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={() => onAct('reset', 'filtered')}>
                {t('bulk.resetFiltered')}
              </Button>
            </>
          )}
          <Button type="button" variant="ghost" size="sm" className={BUTTON} onClick={onSelectAll}>
            {t('bulk.selectAll', { count: filteredCount })}
          </Button>
        </div>
      )}
    </section>
  );
}
