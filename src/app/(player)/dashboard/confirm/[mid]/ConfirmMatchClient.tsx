'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PlateButton from '@/components/match/PlateButton';
import StickyActionBar from '@/components/match/StickyActionBar';
import Alert from '@/components/ui/Alert';
import Textarea from '@/components/ui/Textarea';
import { MATCH_REASON_MAX_LENGTH } from '@/lib/admin/match-detail';
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

/** POST body for the confirm-match route. The reason only ever travels with a dispute, trimmed and never empty. */
export function buildConfirmMatchBody(
  action: 'confirm' | 'dispute',
  reason: string,
): { action: 'confirm' | 'dispute'; reason?: string } {
  const trimmed = reason.trim();
  if (action !== 'dispute' || trimmed.length === 0) return { action };
  return { action, reason: trimmed };
}

/** An action error: the network failure (by key) or an API failure. Translated at render. */
type ActionError = { kind: 'updateFailed' } | { kind: 'api'; error: ApiErrorLike };

/** The request: `done` once it succeeded, kept until the redirect, so the result cannot be sent twice. */
type SubmitPhase = 'idle' | 'submitting' | 'done';

export default function ConfirmMatchClient({
  matchId,
  canConfirm,
  canDispute,
  redirectTo,
}: ConfirmMatchClientProps) {
  const router = useRouter();
  const t = useT(matchFormsMessages);
  const apiErrorText = useApiErrorText(errorsMatches);
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  const loading = phase === 'submitting';
  const [error, setError] = useState<ActionError | null>(null);
  const [reason, setReason] = useState('');
  const [successKey, setSuccessKey] = useState<'confirmed' | 'disputed' | null>(null);

  async function handleAction(action: 'confirm' | 'dispute') {
    if (phase !== 'idle') return;
    setError(null);
    setSuccessKey(null);
    setPhase('submitting');

    try {
      const res = await fetch(`/api/confirm-match/${matchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildConfirmMatchBody(action, reason)),
      });

      const json = await res.json();

      if (json.success) {
        setPhase('done');
        setSuccessKey(action === 'confirm' ? 'confirmed' : 'disputed');
        setReason('');
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
      setPhase((current) => (current === 'submitting' ? 'idle' : current));
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-poke-lg border border-hairline bg-surface p-4 sm:p-5">
      {error && (
        <Alert variant="error">
          {error.kind === 'api' ? apiErrorText(error.error) : t('confirm.updateFailed')}
        </Alert>
      )}
      {successKey && <Alert variant="success">{t(`confirm.${successKey}`)}</Alert>}

      {canDispute && (
        <div className="flex flex-col gap-1">
          <Textarea
            id="dispute-reason"
            label={t('confirm.disputeReasonLabel')}
            placeholder={t('confirm.disputeReasonPlaceholder')}
            hint={t('confirm.disputeReasonHint')}
            maxLength={MATCH_REASON_MAX_LENGTH}
            rows={3}
            value={reason}
            disabled={phase !== 'idle'}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-right text-caption tabular-nums text-fg-muted">
            {t('confirm.disputeReasonCount', { count: reason.length, max: MATCH_REASON_MAX_LENGTH })}
          </p>
        </div>
      )}

      {(canConfirm || canDispute) && (
        <StickyActionBar>
          {canConfirm && (
            <PlateButton
              className="flex-1 sm:flex-none"
              loading={loading}
              disabled={phase === 'done'}
              onClick={() => handleAction('confirm')}
            >
              {t('confirm.confirmResult')}
            </PlateButton>
          )}
          {canDispute && (
            <PlateButton
              tone="secondary"
              className="flex-1 sm:flex-none"
              loading={loading}
              disabled={phase === 'done'}
              onClick={() => handleAction('dispute')}
            >
              {t('confirm.disputeResult')}
            </PlateButton>
          )}
        </StickyActionBar>
      )}

      {!canConfirm && !canDispute && (
        <p className="text-body text-fg-muted">
          {t('confirm.cannotAct')}
        </p>
      )}
    </div>
  );
}
