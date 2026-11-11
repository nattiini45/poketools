import Card from '@/components/ui/Card';
import SignUpForm from './SignUpForm';
import { getT } from '@/i18n/server';
import { authMessages } from '@/i18n/messages/auth';
import { discordOAuthEnabled } from '@/lib/env';

// Public: no auth required

export default async function SignUpPage() {
  const t = await getT(authMessages);
  return (
    <Card padding="lg">
      <h1 className="font-heading text-display text-fg mb-4">
        {t('signUp.title')}
      </h1>
      {discordOAuthEnabled() && (
        <p className="text-sm text-fg-muted mb-4">{t('signUp.discordHint')}</p>
      )}
      <SignUpForm />
    </Card>
  );
}
