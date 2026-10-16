'use client';

import type { MatchStatus } from '@/types/match';
import Badge from '@/components/ui/Badge';
import { useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';

type BadgeVariant = 'gray' | 'blue' | 'yellow' | 'green' | 'red';

const STATUS_VARIANT: Record<MatchStatus, BadgeVariant> = {
  scheduled: 'gray',
  in_progress: 'blue',
  pending_confirmation: 'yellow',
  completed: 'green',
  disputed: 'red',
};

interface MatchStatusBadgeProps {
  status: MatchStatus;
  /**
   * Optional override of the chip's text. The colour still follows the
   * status; absent, the `enums.matchStatus` label in the viewer's language.
   */
  label?: string;
}

export default function MatchStatusBadge({ status, label }: MatchStatusBadgeProps) {
  const t = useT(enumMessages);
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'gray'} size="sm">
      {label ?? enumLabel(t, 'matchStatus', status)}
    </Badge>
  );
}
