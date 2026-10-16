'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsMatches } from '@/i18n/messages/errors';
import { matchFormsMessages } from '@/i18n/messages/match/forms';

import type { ApiResult } from '@/types/api';

interface ReplaySubmitFormProps {
  matchId: string;
  onSuccess?: () => void;
  /** URL to redirect to after successful submission */
  redirectTo?: string;
  /** When true, a name-mismatch offers the manual-assign fallback. */
  isAdmin?: boolean;
  /** Called with the entered URL when the admin opts to assign sides manually. */
  onManualAssign?: (replayUrl: string) => void;
}

/** A form error: a client-side check (by key) or an API failure. Translated at render. */
type FormError =
  | { kind: 'enterReplayUrl' }
  | { kind: 'invalidUrl' }
  | { kind: 'submitFailed' }
  | { kind: 'api'; error: ApiErrorLike };

export default function ReplaySubmitForm({
  matchId,
  onSuccess,
  redirectTo,
  isAdmin,
  onManualAssign,
}: ReplaySubmitFormProps) {
  const router = useRouter();
  const t = useT(matchFormsMessages);
  const apiErrorText = useApiErrorText(errorsMatches);
  const [replayUrl, setReplayUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [successKey, setSuccessKey] = useState<'recordedComplete' | 'recordedMore' | null>(null);
  const [nameMismatch, setNameMismatch] = useState(false);
  const [mismatchDetails, setMismatchDetails] = useState<{
    submittedUrl: string;
    psUsernames: string[];
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessKey(null);
    setNameMismatch(false);
    setMismatchDetails(null);

    if (!replayUrl.trim()) {
      setError({ kind: 'enterReplayUrl' });
      return;
    }

    const isValid =
      replayUrl.includes('replay.pokemonshowdown.com') ||
      /^[a-z0-9-]+$/.test(replayUrl.trim());

    if (!isValid) {
      setError({ kind: 'invalidUrl' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/parse-replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: matchId,
          replay_url: replayUrl.trim(),
        }),
      });

      const json: ApiResult<{ bo_reached: boolean }> = await res.json();

      if (json.success) {
        setSuccessKey(json.data.bo_reached ? 'recordedComplete' : 'recordedMore');
        setReplayUrl('');
        onSuccess?.();
        if (redirectTo) {
          setTimeout(() => {
            router.refresh();
            router.push(redirectTo);
          }, 1500);
        } else {
          router.refresh();
        }
      } else {
        setError({ kind: 'api', error: toApiErrorLike(json) });
        if (json.code === 'name_mismatch' || json.code === 'replay_player_not_in_match') {
          setNameMismatch(true);
          setMismatchDetails({
            submittedUrl: replayUrl.trim(),
            psUsernames: json.ps_usernames ?? [],
          });
        }
      }
    } catch {
      setError({ kind: 'submitFailed' });
    } finally {
      setLoading(false);
    }
  }

  function errorMessage(e: FormError): string {
    switch (e.kind) {
      case 'enterReplayUrl':
        return t('common.enterReplayUrl');
      case 'invalidUrl':
        return t('replaySubmit.invalidUrl');
      case 'submitFailed':
        return t('replaySubmit.submitFailed');
      case 'api':
        return apiErrorText(e.error);
    }
  }

  const details = mismatchDetails && (
    <div className="text-sm space-y-1 font-mono text-poke-text-secondary">
      <p>
        <span className="font-sans font-heading font-semibold text-poke-text-primary">
          {t('replaySubmit.submittedUrl')}
        </span>{' '}
        {mismatchDetails.submittedUrl}
      </p>
      <p>
        <span className="font-sans font-heading font-semibold text-poke-text-primary">
          {t('replaySubmit.parsedNames')}
        </span>{' '}
        {mismatchDetails.psUsernames.length > 0
          ? mismatchDetails.psUsernames.join(` ${t('replaySubmit.versus')} `)
          : t('replaySubmit.unavailable')}
      </p>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        label={t('replaySubmit.urlLabel')}
        type="text"
        value={replayUrl}
        onChange={(e) => setReplayUrl(e.target.value)}
        placeholder="https://replay.pokemonshowdown.com/..."
        disabled={loading}
        autoComplete="off"
      />

      {error && <Alert variant="error">{errorMessage(error)}</Alert>}
      {successKey && <Alert variant="success">{t(`replaySubmit.${successKey}`)}</Alert>}

      {nameMismatch && (
        isAdmin && onManualAssign ? (
          <Alert variant="warning">
            <div className="space-y-2">
              <p>{t('replaySubmit.nameMismatch')}</p>
              {details}
              <Button
                type="button"
                variant="secondary"
                onClick={() => onManualAssign(replayUrl.trim())}
              >
                {t('replaySubmit.assignManually')}
              </Button>
            </div>
          </Alert>
        ) : (
          <Alert variant="warning">
            <div className="space-y-2">
              <p>{t('replaySubmit.nameMismatchAsk')}</p>
              {details}
            </div>
          </Alert>
        )
      )}

      <Button type="submit" variant="secondary" loading={loading}>
        {t('replaySubmit.submit')}
      </Button>
    </form>
  );
}
