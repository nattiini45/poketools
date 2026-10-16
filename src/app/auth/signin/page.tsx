import Card from '@/components/ui/Card';
import { getT } from '@/i18n/server';
import { authMessages } from '@/i18n/messages/auth';
import SignInForm from './SignInForm';

// Public: no auth required

/**
 * NextAuth redirects here with ?error= on OAuth failures. The form shows the
 * message keyed by that code (`auth.signIn.errors`); an unknown code shows
 * `Default`. Only the code crosses to the client, never translated text.
 */
function signInErrorCode(raw: string | undefined, known: (code: string) => boolean): string | null {
  if (!raw) return null;
  return /^[A-Za-z0-9_]+$/.test(raw) && known(raw) ? raw : 'Default';
}

interface SignInPageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const t = await getT(authMessages);
  // Only allow same-origin relative redirect targets (no open redirect)
  const callbackUrl =
    params.callbackUrl?.startsWith('/') && !params.callbackUrl.startsWith('//')
      ? params.callbackUrl
      : '/';
  const initialErrorCode = signInErrorCode(params.error, (code) => t.has(`signIn.errors.${code}`));

  return (
    <Card padding="lg">
      <h1 className="text-xl font-heading font-bold text-poke-text-primary mb-4">
        {t('signIn.title')}
      </h1>
      <SignInForm callbackUrl={callbackUrl} initialErrorCode={initialErrorCode} />
    </Card>
  );
}
