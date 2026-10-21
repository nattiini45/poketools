'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsMatches } from '@/i18n/messages/errors';
import { matchFormsMessages } from '@/i18n/messages/match/forms';

interface ConfirmMatchClientProps {
  matchId: string;
  canConfirm: boolean;
  canDispute: boolean;
  /** URL to redirect to after confirm/dispute */
  redirectTo?: string;
}

/** An action error: the network failure (by key) or an API failure. Translated at render. */
type ActionError = { kind: 'updateFailed' } | { kind: 'api'; error: ApiErrorLike };

export default function ConfirmMatchClient({
  matchId,
  canConfirm,
  canDispute,
  redirectTo,
}: ConfirmMatchClientProps) {
  const router = useRouter();
  const t = useT(matchFormsMessages);
  const apiErrorText = useApiErrorText(errorsMatches);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [successKey, setSuccessKey] = useState<'confirmed' | 'disputed' | null>(null);

  async function handleAction(action: 'confirm' | 'dispute') {
    setError(null);
    setSuccessKey(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/confirm-match/${matchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const json = await res.json();

      if (json.success) {
        setSuccessKey(action === 'confirm' ? 'confirmed' : 'disputed');
        setTimeout(() => {
          router.refresh();
          router.push(redirectTo ?? '/dashboard');
        }, 2000);
      } else {
        setError({ kind: 'api', error: toApiErrorLike(json) });
      }
    } catch {
      setError({ kind: 'updateFailed' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="error">
          {error.kind === 'api' ? apiErrorText(error.error) : t('confirm.updateFailed')}
        </Alert>
      )}
      {successKey && <Alert variant="success">{t(`confirm.${successKey}`)}</Alert>}

      <div className="flex gap-3">
        {canConfirm && (
          <Button
            variant="success"
            loading={loading}
            onClick={() => handleAction('confirm')}
          >
            {t('confirm.confirmResult')}
          </Button>
        )}
        {canDispute && (
          <Button
            variant="danger"
            loading={loading}
            onClick={() => handleAction('dispute')}
          >
            {t('confirm.disputeResult')}
          </Button>
        )}
      </div>

      {!canConfirm && !canDispute && (
        <p className="text-sm text-poke-text-muted">
          {t('confirm.cannotAct')}
        </p>
      )}
    </div>
  );
}
