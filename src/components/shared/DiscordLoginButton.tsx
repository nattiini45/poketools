'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import Button from '@/components/ui/Button';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import { useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';
import { clearPwaCaches } from '@/lib/pwa/caches';

const subscribe = () => () => {};

// The worker's caches can hold what this session saw; they go before the session does.
async function signOutAndClearCaches() {
  await clearPwaCaches();
  await signOut();
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

  // Signed-out: link to the sign-in page (Discord OAuth or email/password)
  return (
    <Link href="/auth/signin" className={getButtonClasses('secondary', 'sm')}>
      {t('session.signIn')}
    </Link>
  );
}
