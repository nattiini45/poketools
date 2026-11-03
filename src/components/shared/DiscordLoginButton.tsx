'use client';

import { Suspense, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import Button from '@/components/ui/Button';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import { useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';
import { clearPwaCaches } from '@/lib/pwa/caches';
import { useSignInHref } from './use-sign-in-href';

const subscribe = () => () => {};

// The worker's caches can hold what this session saw; they go before the session does.
async function signOutAndClearCaches() {
  await clearPwaCaches();
  await signOut();
}

function SignInLink({ href }: { href: string }) {
  const t = useT(shellMessages);
  return (
    <Link href={href} className={getButtonClasses('secondary', 'sm')}>
      {t('session.signIn')}
    </Link>
  );
}

function SignInLinkForPage() {
  return <SignInLink href={useSignInHref()} />;
}

export default function DiscordLoginButton() {
  const { data: session, status } = useSession();
  const t = useT(shellMessages);
  // Avoid hydration mismatch: render nothing on first paint, then show client state
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  if (!mounted || status === 'loading') {
    return (
      <Button variant="ghost" size="sm" disabled={false}>
        &nbsp;
      </Button>
    );
  }

  if (session) {
    return (
      <Button variant="ghost" size="sm" onClick={() => void signOutAndClearCaches()}>
        {t('session.signOut')}
      </Button>
    );
  }

  // Signed-out: link to the sign-in page (Discord OAuth or email/password) that returns to this page
  return (
    <Suspense fallback={<SignInLink href="/auth/signin" />}>
      <SignInLinkForPage />
    </Suspense>
  );
}
