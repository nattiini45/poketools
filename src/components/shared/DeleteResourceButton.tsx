'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { uiMessages } from '@/i18n/messages/ui';
import { errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';

interface DeleteResourceButtonProps {
  resourceType: 'season' | 'tournament';
  resourceId: string;
  resourceName: string;
  redirectTo: string;
  /** Button text; the localized "Delete" by default. */
  label?: string;
}

export default function DeleteResourceButton({
  resourceType,
  resourceId,
  resourceName,
  redirectTo,
  label,
}: DeleteResourceButtonProps) {
  const router = useRouter();
  const t = useT(uiMessages);
  const errorText = useApiErrorText(errorsSeasons, errorsTournaments);
  const [loading, setLoading] = useState(false);

  const endpoint = resourceType === 'season'
    ? `/api/seasons/${resourceId}`
    : `/api/tournaments/${resourceId}`;

  async function handleDelete() {
    const confirmed = window.confirm(t(`deleteResource.confirm.${resourceType}`, { name: resourceName }));
    if (!confirmed) return;

    setLoading(true);
    try {
      const res = await fetch(endpoint, { method: 'DELETE' });
      const result = await res.json().catch(() => null) as { error?: string; code?: string } | null;

      if (!res.ok) {
        window.alert(
          result?.error || result?.code ? errorText(result) : t(`deleteResource.failed.${resourceType}`),
        );
        return;
      }

      router.push(redirectTo);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="danger" size="sm" onClick={handleDelete} loading={loading}>
      {label ?? t('deleteResource.label')}
    </Button>
  );
}
