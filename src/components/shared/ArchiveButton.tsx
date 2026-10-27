'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { uiMessages } from '@/i18n/messages/ui';
import { errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';

interface ArchiveButtonProps {
  resourceType: 'season' | 'tournament';
  resourceId: string;
  isArchived: boolean;
}

export default function ArchiveButton({ resourceType, resourceId, isArchived }: ArchiveButtonProps) {
  const router = useRouter();
  const t = useT(uiMessages);
  const errorText = useApiErrorText(errorsSeasons, errorsTournaments);
  const [loading, setLoading] = useState(false);

  const endpoint = resourceType === 'season'
    ? `/api/seasons/${resourceId}`
    : `/api/tournaments/${resourceId}`;

  const label = isArchived ? t('archive.unarchive') : t('archive.archive');
  const confirmMessage = isArchived
    ? t(`archive.confirmUnarchive.${resourceType}`)
    : t(`archive.confirmArchive.${resourceType}`);

  async function handleClick() {
    if (!confirm(confirmMessage)) return;

    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !isArchived }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        alert(data?.error || data?.code ? errorText(data) : t('archive.failed'));
        return;
      }

      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`${getButtonClasses('secondary', 'sm')} min-h-11 sm:min-h-0`}
    >
      {loading ? t('archive.busy') : label}
    </button>
  );
}
