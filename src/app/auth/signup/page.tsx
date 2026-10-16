import Card from '@/components/ui/Card';
import SignUpForm from './SignUpForm';
import { getT } from '@/i18n/server';
import { authMessages } from '@/i18n/messages/auth';

// Public: no auth required

export default async function SignUpPage() {
  const t = await getT(authMessages);
  return (
    <Card padding="lg">
      <h1 className="text-xl font-heading font-bold text-poke-text-primary mb-1">
        {t('signUp.title')}
      </h1>
      <p className="text-sm text-poke-text-secondary mb-4">
        {t('signUp.discordHint')}
      </p>
      <SignUpForm />
    </Card>
  );
}
