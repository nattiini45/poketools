import Link from 'next/link';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import ConfirmEmailClient from './ConfirmEmailClient';
import { getT } from '@/i18n/server';
import { authMessages } from '@/i18n/messages/auth';

// Public: no auth required
//
// Landing page for the Supabase "Confirm signup" email template:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
// Confirmation is button-gated (POST) so mail scanners can't burn the token.

interface ConfirmPageProps {
  searchParams: Promise<{ token_hash?: string }>;
}

export default async function ConfirmPage({ searchParams }: ConfirmPageProps) {
  const params = await searchParams;
  const tokenHash = params.token_hash ?? '';
  const t = await getT(authMessages);

  return (
    <Card padding="lg">
      <h1 className="text-xl font-heading font-bold text-poke-text-primary mb-2">
        {t('confirmEmail.title')}
      </h1>
      {tokenHash ? (
        <ConfirmEmailClient tokenHash={tokenHash} />
      ) : (
        <div className="space-y-3">
          <Alert variant="error">
            {t('confirmEmail.missingToken')}
          </Alert>
          <Link href="/auth/verify-email" className="text-sm underline text-poke-text-secondary hover:text-poke-text-primary">
            {t('confirmEmail.resend')}
          </Link>
        </div>
      )}
    </Card>
  );
}
