import Card from '@/components/ui/Card';
import ResendVerificationForm from './ResendVerificationForm';
import { getT } from '@/i18n/server';
import { authMessages } from '@/i18n/messages/auth';

// Public: no auth required

interface VerifyEmailPageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  const email = params.email ?? '';
  const t = await getT(authMessages);

  return (
    <Card padding="lg">
      <h1 className="font-heading text-display text-fg mb-4">
        {t('verifyEmail.title')}
      </h1>
      <p className="text-sm text-fg-muted mb-4">
        {email ? t('verifyEmail.introTo', { email }) : t('verifyEmail.intro')}
      </p>
      <ResendVerificationForm initialEmail={email} />
    </Card>
  );
}
