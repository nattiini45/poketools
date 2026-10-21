import Card from '@/components/ui/Card';
import ForgotPasswordForm from './ForgotPasswordForm';
import { getT } from '@/i18n/server';
import { authMessages } from '@/i18n/messages/auth';

// Public: no auth required

export default async function ForgotPasswordPage() {
  const t = await getT(authMessages);
  return (
    <Card padding="lg">
      <h1 className="text-xl font-heading font-bold text-poke-text-primary mb-2">
        {t('forgotPassword.title')}
      </h1>
      <p className="text-sm text-poke-text-secondary mb-4">
        {t('forgotPassword.intro')}
      </p>
      <ForgotPasswordForm />
    </Card>
  );
}
