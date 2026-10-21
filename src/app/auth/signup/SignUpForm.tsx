'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Alert from '@/components/ui/Alert';
import type { ApiResult } from '@/types/api';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { authMessages } from '@/i18n/messages/auth';
import { errorsAuth } from '@/i18n/messages/errors';

/** A client-side failure (a key of `auth`) or the API's own error. Never translated text. */
type FormError = { kind: 'mismatch' } | { kind: 'failed' } | { kind: 'api'; error: ApiErrorLike };

export default function SignUpForm() {
  const router = useRouter();
  const t = useT(authMessages);
  const errorText = useApiErrorText(errorsAuth);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<FormError | null>(null);
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
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, display_name: displayName }),
      });
      const json = (await res.json()) as ApiResult<{ message: string }>;
      if (!json.success) {
        setError({ kind: 'api', error: json });
        return;
      }
      router.push(`/auth/verify-email?email=${encodeURIComponent(email)}`);
    } catch {
      setError({ kind: 'failed' });
    } finally {
      setLoading(false);
    }
  };

  const message =
    error === null
      ? null
      : error.kind === 'mismatch'
        ? t('passwordsMismatch')
        : error.kind === 'failed'
          ? t('signUp.failed')
          : errorText(error.error);

  return (
    <div className="space-y-4">
      {message && <Alert variant="error">{message}</Alert>}

      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          label={t('fields.displayName')}
          type="text"
          autoComplete="nickname"
          required
          maxLength={100}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          hint={t('fields.displayNameHint')}
        />
        <Input
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label={t('fields.password')}
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
          label={t('fields.confirmPassword')}
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        <Button type="submit" className="w-full" loading={loading}>
          {t('signUp.submit')}
        </Button>
      </form>

      <p className="text-sm text-poke-text-secondary text-center">
        {t('signUp.haveAccount')}{' '}
        <Link href="/auth/signin" className="underline hover:text-poke-text-primary">
          {t('signUp.signIn')}
        </Link>
      </p>
    </div>
  );
}
