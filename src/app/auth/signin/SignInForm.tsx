'use client';

import { useState } from 'react';
import { sanitizeCallbackUrl } from '@/lib/auth/safe-callback-url';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { authMessages } from '@/i18n/messages/auth';

interface SignInFormProps {
  callbackUrl: string;
  /** A key of `auth.signIn.errors` (the NextAuth `?error=` code), checked by the page. */
  initialErrorCode: string | null;
}

/** What went wrong: an OAuth error code from the redirect, bad credentials, or too many attempts (the sign-in rate limit). */
type SignInError = { kind: 'oauth'; code: string } | { kind: 'credentials' } | { kind: 'tooManyAttempts' };

export default function SignInForm({ callbackUrl, initialErrorCode }: SignInFormProps) {
  const t = useT(authMessages);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<SignInError | null>(
    initialErrorCode ? { kind: 'oauth', code: initialErrorCode } : null,
  );
  const [needsVerification, setNeedsVerification] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setLoading(true);
    try {
      const res = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        if (res.code === 'email_not_verified') {
          setNeedsVerification(true);
        } else if (res.code === 'too_many_attempts') {
          setError({ kind: 'tooManyAttempts' });
        } else {
          setError({ kind: 'credentials' });
        }
        return;
      }
      // Full navigation so the server-rendered session is picked up
      // Checked again here: the page already sanitizes, but this form must not rely on every caller doing it.
      window.location.assign(sanitizeCallbackUrl(callbackUrl));
    } finally {
      setLoading(false);
    }
  };

  const errorText =
    error === null
      ? null
      : error.kind === 'credentials'
        ? t('signIn.invalidCredentials')
        : error.kind === 'tooManyAttempts'
          ? t('signIn.tooManyAttempts')
          : t.dynamic(`signIn.errors.${error.code}`, undefined, t('signIn.errors.Default'));

  return (
    <div className="space-y-4">
      {errorText && <Alert variant="error">{errorText}</Alert>}
      {needsVerification && (
        <Alert variant="warning">
          {t('signIn.verifyFirst')}{' '}
          <Link
            href={`/auth/verify-email?email=${encodeURIComponent(email)}`}
            className="font-semibold underline"
          >
            {t('signIn.resendVerification')}
          </Link>
        </Alert>
      )}

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => signIn('discord', { callbackUrl: sanitizeCallbackUrl(callbackUrl) })}
      >
        {t('signIn.discord')}
      </Button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-poke-border" />
        <span className="text-xs text-poke-text-muted">{t('signIn.orEmail')}</span>
        <div className="h-px flex-1 bg-poke-border" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" className="w-full" loading={loading}>
          {t('signIn.submit')}
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm">
        <Link href="/auth/forgot-password" className="text-poke-text-secondary hover:text-poke-text-primary underline">
          {t('signIn.forgotPassword')}
        </Link>
        <Link href="/auth/signup" className="text-poke-text-secondary hover:text-poke-text-primary underline">
          {t('signIn.createAccount')}
        </Link>
      </div>
    </div>
  );
}
