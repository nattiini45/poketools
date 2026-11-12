'use client';

import type { ReactNode } from 'react';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import { useT } from '@/i18n/client';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

/**
 * The result panel of an admin task card (redesign A13): what the last run answered, set apart from the controls
 * on the elevated ground, with a plate that says what kind of run it was (a dry run changes nothing).
 */
export default function TaskResultPanel({
  chip,
  tone = 'neutral',
  aside,
  children,
}: {
  chip?: string;
  tone?: SkewChipTone;
  /** The end of the header row: when the result was produced. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const t = useT(adminToolsMessages);
  return (
    <div className="mt-4 rounded-poke-md border border-hairline bg-elevated" data-task-result>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-hairline px-3 py-2">
        <span className="text-caption font-[550] text-fg-muted">{t('data.result')}</span>
        {chip && <SkewChip tone={tone}>{chip}</SkewChip>}
        {aside && <span className="ml-auto text-caption text-fg-muted">{aside}</span>}
      </div>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </div>
  );
}
