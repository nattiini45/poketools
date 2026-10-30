'use client';

import { useCallback, useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Alert from '@/components/ui/Alert';
import Link from 'next/link';
import type { ApiResult } from '@/types/api';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { accountMessages } from '@/i18n/messages/account';
import { errorsAuth } from '@/i18n/messages/errors';
import type accountEn from '@/i18n/messages/account/en';

interface AccountIdentities {
  hasDiscord: boolean;
  hasEmail: boolean;
  email: string | null;
  emailConfirmed: boolean;
}

/** A client-side failure (a key of `account.security`) or the API's own error. Never translated text. */
type SecurityErrorKey = keyof typeof accountEn.security & (
  'loadFailed' | 'passwordsMismatch' | 'linkEmailFailed' | 'linkDiscordFailed'
);
type SecurityError = { kind: 'key'; key: SecurityErrorKey } | { kind: 'api'; error: ApiErrorLike };

export default function AccountSecuritySection() {
  const t = useT(accountMessages);
  const errorText = useApiErrorText(errorsAuth);
  const [identities, setIdentities] = useState<AccountIdentities | null>(null);
  const [loadError, setLoadError] = useState<SecurityError | null>(null);

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<SecurityError | null>(null);
  const [emailLinked, setEmailLinked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [linkingDiscord, setLinkingDiscord] = useState(false);

  const loadIdentities = useCallback(async () => {
    try {
      const res = await fetch('/api/account/identities');
      const json = (await res.json()) as ApiResult<AccountIdentities>;
      if (json.success) {
        setIdentities(json.data);
      } else {
        setLoadError({ kind: 'api', error: json });
      }
    } catch {
      setLoadError({ kind: 'key', key: 'loadFailed' });
    }
  }, []);

  useEffect(() => {
    void loadIdentities();
  }, [loadIdentities]);

  const handleLinkEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setEmailLinked(false);

    if (password !== confirmPassword) {
      setFormError({ kind: 'key', key: 'passwordsMismatch' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/account/link-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = (await res.json()) as ApiResult<{ message: string }>;
      if (json.success) {
        setEmailLinked(true);
        setShowEmailForm(false);
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        void loadIdentities();
      } else {
        setFormError({ kind: 'api', error: json });
      }
    } catch {
      setFormError({ kind: 'key', key: 'linkEmailFailed' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLinkDiscord = async () => {
    setFormError(null);
    setEmailLinked(false);
    setLinkingDiscord(true);
    try {
      const res = await fetch('/api/account/link-discord', { method: 'POST' });
      const json = (await res.json()) as ApiResult<{ message: string }>;
      if (!json.success) {
        setFormError({ kind: 'api', error: json });
        return;
      }
      // Intent cookie is set — start the OAuth flow; the signIn callback
      // performs the actual link.
      await signIn('discord', { callbackUrl: '/dashboard/settings?linked=discord' });
    } catch {
      setFormError({ kind: 'key', key: 'linkDiscordFailed' });
    } finally {
      setLinkingDiscord(false);
    }
  };

  const describe = (err: SecurityError): string =>
    err.kind === 'key' ? t(`security.${err.key}`) : errorText(err.error);

  const emailStatus = (ids: AccountIdentities): string => {
    if (!ids.hasEmail) return t('security.notLinked');
    const shown = ids.email ?? t('security.linked');
    return ids.emailConfirmed ? shown : t('security.unconfirmed', { email: shown });
  };

  return (
    <Card padding="lg">
      <h2 className="text-lg font-heading font-bold text-poke-text-primary mb-1">
        {t('security.title')}
      </h2>
      <p className="text-sm text-poke-text-secondary mb-4">
        {t('security.intro')}
      </p>

      {loadError && <Alert variant="error">{describe(loadError)}</Alert>}
      {formError && (
        <Alert variant="error" className="mb-3">
          {describe(formError)}
          {/* The address is taken: if it is the player's own unconfirmed one, the confirmation email can be sent again. */}
          {formError.kind === 'api' && formError.error.code === 'email_already_registered' && email !== '' && (
            <>
              {' '}
              <Link href={`/auth/verify-email?email=${encodeURIComponent(email)}`} className="font-semibold underline">
                {t('security.resendVerification')}
              </Link>
            </>
          )}
        </Alert>
      )}
      {emailLinked && <Alert variant="success" className="mb-3">{t('security.emailLinked')}</Alert>}

      {identities && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-heading font-semibold text-poke-text-primary">{t('security.discord')}</p>
              <p className="text-sm text-poke-text-muted">
                {identities.hasDiscord ? t('security.linked') : t('security.notLinked')}
              </p>
            </div>
            {!identities.hasDiscord && (
              <Button variant="secondary" size="sm" onClick={handleLinkDiscord} loading={linkingDiscord}>
                {t('security.linkDiscord')}
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-heading font-semibold text-poke-text-primary">{t('security.emailPassword')}</p>
              <p className="text-sm text-poke-text-muted">{emailStatus(identities)}</p>
            </div>
            {!identities.hasEmail && !showEmailForm && (
              <Button variant="secondary" size="sm" onClick={() => setShowEmailForm(true)}>
                {t('security.addEmail')}
              </Button>
            )}
          </div>

          {showEmailForm && !identities.hasEmail && (
            <form onSubmit={handleLinkEmail} className="space-y-3 border-t border-poke-border pt-4">
              <Input
                label={t('security.email')}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                label={t('security.password')}
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint={t('security.passwordHint')}
              />
              <Input
                label={t('security.confirmPassword')}
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={submitting}>
                  {t('security.linkEmail')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowEmailForm(false)}>
                  {t('security.cancel')}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
