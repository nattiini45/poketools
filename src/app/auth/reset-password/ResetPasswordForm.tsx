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
type FormError = { kind: 'mismatch' } | { kind: 'failed' } | { kind: 'api'; error: ApiErrorLike };

export default function ResetPasswordForm({ tokenHash }: { tokenHash: string }) {
  const t = useT(authMessages);
  const errorText = useApiErrorText(errorsAuth);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError({ kind: 'mismatch' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_hash: tokenHash, password }),
      });
      const json = (await res.json()) as ApiResult<{ message: string }>;
      if (json.success) {
        setDone(true);
      } else {
        setError({ kind: 'api', error: json });
      }
    } catch {
      setError({ kind: 'failed' });
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-3">
        <Alert variant="success">{t('resetPassword.done')}</Alert>
        <Link href="/auth/signin" className="block">
          <Button className="w-full">{t('resetPassword.signIn')}</Button>
        </Link>
      </div>
    );
  }

  const message =
    error === null
      ? null
      : error.kind === 'mismatch'
        ? t('passwordsMismatch')
        : error.kind === 'failed'
          ? t('resetPassword.failed')
          : errorText(error.error);

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {message && <Alert variant="error">{message}</Alert>}
      <Input
        label={t('fields.newPassword')}
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={72}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={t('fields.passwordHint')}
      />
      <Input
        label={t('fields.confirmNewPassword')}
        type="password"
        autoComplete="new-password"
        required
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      <Button type="submit" className="w-full" loading={loading}>
        {t('resetPassword.submit')}
      </Button>
    </form>
  );
}
