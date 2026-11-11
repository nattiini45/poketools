'use client';

import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import { useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import type { MatchStatus } from '@/types/match';

const STATUS_TONE: Record<MatchStatus, SkewChipTone> = {
  scheduled: 'neutral',
  in_progress: 'live',
  pending_confirmation: 'accent',
  completed: 'win',
  disputed: 'loss',
};

interface MatchStatusChipProps {
  status: MatchStatus;
  className?: string;
}

/**
 * The match status as a Direction B skewed chip, for the redesigned player pages. `MatchStatusBadge` stays on the
 * pre-redesign badge because the frozen match highlight card reaches it.
 */
export default function MatchStatusChip({ status, className }: MatchStatusChipProps) {
  const t = useT(enumMessages);
  return (
    <SkewChip tone={STATUS_TONE[status] ?? 'neutral'} className={className}>
      {enumLabel(t, 'matchStatus', status)}
    </SkewChip>
  );
}
