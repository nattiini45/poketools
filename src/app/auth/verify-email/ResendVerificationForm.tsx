'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Alert from '@/components/ui/Alert';
import type { ApiResult } from '@/types/api';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { authMessages } from '@/i18n/messages/auth';
import { errorsAuth } from '@/i18n/messages/errors';

/** A client-side failure or the API's own error. Never translated text. */
type FormError = { kind: 'failed' } | { kind: 'api'; error: ApiErrorLike };

export default function ResendVerificationForm({ initialEmail }: { initialEmail: string }) {
  const t = useT(authMessages);
  const errorText = useApiErrorText(errorsAuth);
  const [email, setEmail] = useState(initialEmail);
  // The server answers one generic sentence; the client shows its own translation.
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSent(false);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json()) as ApiResult<{ message: string }>;
      if (json.success) {
        setSent(true);
      } else {
        setError({ kind: 'api', error: json });
      }
    } catch {
      setError({ kind: 'failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {sent && <Alert variant="success">{t('verifyEmail.resent')}</Alert>}
      {error && (
        <Alert variant="error">
          {error.kind === 'failed' ? t('verifyEmail.failed') : errorText(error.error)}
        </Alert>
      )}
      <Input
        label={t('fields.email')}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" variant="secondary" className="w-full" loading={loading}>
        {t('verifyEmail.resend')}
      </Button>
    </form>
  );
}
