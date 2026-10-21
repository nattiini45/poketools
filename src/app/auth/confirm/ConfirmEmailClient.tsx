'use client';

import { useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import type { ApiResult } from '@/types/api';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { authMessages } from '@/i18n/messages/auth';
import { errorsAuth } from '@/i18n/messages/errors';

/** A client-side failure or the API's own error. Never translated text. */
type ConfirmError = { kind: 'failed' } | { kind: 'api'; error: ApiErrorLike };

export default function ConfirmEmailClient({ tokenHash }: { tokenHash: string }) {
  const t = useT(authMessages);
  const errorText = useApiErrorText(errorsAuth);
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<ConfirmError | null>(null);

  const handleConfirm = async () => {
    setState('loading');
    setError(null);
    try {
      const res = await fetch('/api/auth/confirm-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_hash: tokenHash }),
      });
      const json = (await res.json()) as ApiResult<{ message: string }>;
      if (json.success) {
        setState('success');
      } else {
        setError({ kind: 'api', error: json });
        setState('error');
      }
    } catch {
      setError({ kind: 'failed' });
      setState('error');
    }
  };

  if (state === 'success') {
    return (
      <div className="space-y-3">
        <Alert variant="success">{t('confirmEmail.done')}</Alert>
        <Link href="/auth/signin" className="block">
          <Button className="w-full">{t('confirmEmail.signIn')}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="error">
          {error.kind === 'failed' ? t('confirmEmail.failed') : errorText(error.error)}
        </Alert>
      )}
      <p className="text-sm text-poke-text-secondary">
        {t('confirmEmail.prompt')}
      </p>
      <Button onClick={handleConfirm} className="w-full" loading={state === 'loading'}>
        {t('confirmEmail.submit')}
      </Button>
      {state === 'error' && (
        <Link href="/auth/verify-email" className="block text-sm underline text-poke-text-secondary hover:text-poke-text-primary">
          {t('confirmEmail.resend')}
        </Link>
      )}
    </div>
  );
}
