'use client';

import { ADMIN_MATCH_BULK_ACTIONS, ADMIN_MATCH_BULK_MAX, type AdminMatchBulkAction } from '@/lib/admin/match-bulk';
import { NATIVE_GHOST, NATIVE_PLATE, NATIVE_SECONDARY } from '@/components/admin/match-styles';
import SkewChip from '@/components/ui/SkewChip';
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
      className="sticky bottom-3 z-30 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-poke-lg border border-accent-ink bg-surface p-2 shadow-poke-lg"
    >
      <div className="flex min-w-0 flex-1 basis-40 items-center gap-3 px-1">
        <SkewChip tone="tier-1" className="shrink-0 px-2.5 font-heading text-title font-normal">
          {count}
        </SkewChip>
        <div className="flex min-w-0 flex-col">
          <span className="text-body font-[550] text-fg">{t('admin.matches.bulk.selectedCount', { count })}</span>
          {count >= ADMIN_MATCH_BULK_MAX && (
            <span className="text-caption text-fg-muted">
            {t('admin.matches.bulk.capReached', { max: ADMIN_MATCH_BULK_MAX })}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onClear} className={`${NATIVE_GHOST} min-h-[44px]`}>
          {t('admin.matches.bulk.clear')}
        </button>
        {ADMIN_MATCH_BULK_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => onAction(action)}
            className={`${action === 'confirm' ? NATIVE_PLATE : NATIVE_SECONDARY} min-h-[44px]`}
          >
            {t(`admin.matches.bulk.actions.${action}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
