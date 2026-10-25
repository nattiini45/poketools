'use client';

import { ADMIN_MATCH_BULK_ACTIONS, ADMIN_MATCH_BULK_MAX, type AdminMatchBulkAction } from '@/lib/admin/match-bulk';
import { getButtonClasses } from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';

/**
 * The bar of the bulk actions: nothing until a row is selected, then the count, Clear and one button per action.
 * It sticks to the bottom of the viewport while the list scrolls under it; the buttons are always enabled (the
 * dialog explains what applies to the selection), and every control is at least 44px high so a phone can hit it.
 */
export default function AdminMatchBulkBar({
  count,
  onClear,
  onAction,
}: {
  count: number;
  onClear: () => void;
  onAction: (action: AdminMatchBulkAction) => void;
}) {
  const t = useT(shellMessages);
  if (count < 1) return null;

  return (
    <div
      role="region"
      aria-label={t('admin.matches.bulk.barLabel')}
      className="sticky bottom-3 z-30 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-poke-lg border border-poke-border-focus bg-poke-surface p-2 shadow-poke-lg"
    >
      <div className="flex min-w-0 flex-1 basis-40 flex-col px-1">
        <span className="text-sm font-heading font-semibold text-poke-text-primary">
          {t('admin.matches.bulk.selectedCount', { count })}
        </span>
        {count >= ADMIN_MATCH_BULK_MAX && (
          <span className="text-xs text-poke-text-muted">
            {t('admin.matches.bulk.capReached', { max: ADMIN_MATCH_BULK_MAX })}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onClear} className={`${getButtonClasses('ghost', 'sm')} min-h-[44px]`}>
          {t('admin.matches.bulk.clear')}
        </button>
        {ADMIN_MATCH_BULK_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => onAction(action)}
            className={`${getButtonClasses(action === 'confirm' ? 'primary' : 'secondary', 'sm')} min-h-[44px]`}
          >
            {t(`admin.matches.bulk.actions.${action}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
