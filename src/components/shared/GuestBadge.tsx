'use client';

import Badge from '@/components/ui/Badge';
import { useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';

/** A cheap client leaf (i18n-core §1.7 rule 2), so server and client parents can both render it. */
export default function GuestBadge() {
  const t = useT(shellMessages);
  return (
    <Badge variant="gray" size="sm">
      {t('guest')}
    </Badge>
  );
}
