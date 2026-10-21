import Link from 'next/link';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import { getT } from '@/i18n/server';
import { authMessages } from '@/i18n/messages/auth';

// Public: no auth required
//
// Generic auth error landing. NextAuth and the account-linking flow redirect
// here with ?error=<code>. The messages are keyed by that code verbatim
// (`auth.errorPage.codes`); an unknown code shows `Default`.

/** Only plain identifiers can be message keys; anything else is `Default`. */
function errorCode(raw: string | undefined): string {
  return raw && /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'Default';
}

interface AuthErrorPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const params = await searchParams;
  const t = await getT(authMessages);
  const code = errorCode(params.error);
  const message = t.has(`errorPage.codes.${code}`)
    ? t.dynamic(`errorPage.codes.${code}`)
    : t('errorPage.codes.Default');

  return (
    <Card padding="lg">
      <h1 className="text-xl font-heading font-bold text-poke-text-primary mb-3">
        {t('errorPage.title')}
      </h1>
      <div className="space-y-4">
        <Alert variant="error">{message}</Alert>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/auth/signin" className="underline text-poke-text-secondary hover:text-poke-text-primary">
            {t('errorPage.backToSignIn')}
          </Link>
          <Link href="/" className="underline text-poke-text-secondary hover:text-poke-text-primary">
            {t('errorPage.home')}
          </Link>
        </div>
      </div>
    </Card>
  );
}
