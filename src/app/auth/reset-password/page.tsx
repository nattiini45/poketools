import Link from 'next/link';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import ResetPasswordForm from './ResetPasswordForm';
import { getT } from '@/i18n/server';
import { authMessages } from '@/i18n/messages/auth';

// Public: no auth required
//
// Landing page for the Supabase "Reset password" email template:
//   {{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery

interface ResetPasswordPageProps {
  searchParams: Promise<{ token_hash?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const tokenHash = params.token_hash ?? '';
  const t = await getT(authMessages);

  return (
    <Card padding="lg">
      <h1 className="text-xl font-heading font-bold text-poke-text-primary mb-2">
        {t('resetPassword.title')}
      </h1>
      {tokenHash ? (
        <ResetPasswordForm tokenHash={tokenHash} />
      ) : (
        <div className="space-y-3">
          <Alert variant="error">
            {t('resetPassword.missingToken')}
          </Alert>
          <Link href="/auth/forgot-password" className="text-sm underline text-poke-text-secondary hover:text-poke-text-primary">
            {t('resetPassword.requestNew')}
          </Link>
        </div>
      )}
    </Card>
  );
}
