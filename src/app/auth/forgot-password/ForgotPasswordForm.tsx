'use client';

import { useState } from 'react';
import Link from 'next/link';
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

export default function ForgotPasswordForm() {
  const t = useT(authMessages);
  const errorText = useApiErrorText(errorsAuth);
  const [email, setEmail] = useState('');
  // The server answers the same generic sentence whether or not the account
  // exists; the client shows its own translation of it.
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSent(false);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
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
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        {sent && <Alert variant="success">{t('forgotPassword.sent')}</Alert>}
        {error && (
          <Alert variant="error">
            {error.kind === 'failed' ? t('forgotPassword.failed') : errorText(error.error)}
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
        <Button type="submit" className="w-full" loading={loading}>
          {t('forgotPassword.submit')}
        </Button>
      </form>
      <p className="text-sm text-poke-text-secondary text-center">
        <Link href="/auth/signin" className="underline hover:text-poke-text-primary">
          {t('forgotPassword.backToSignIn')}
        </Link>
      </p>
    </div>
  );
}
