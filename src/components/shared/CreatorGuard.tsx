import { redirectToSignIn } from '@/lib/auth/redirect-to-sign-in';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getT } from '@/i18n/server';
import { shellMessages } from '@/i18n/messages/shell';

interface CreatorGuardProps {
  children: React.ReactNode;
}

/**
 * Live view gate (D37): decides from the live player row, not the session
 * copy, so a revoked creator (or a banned one) loses these pages on the next
 * render. `isCreator` already includes site admins, as requireCreator() does.
 */
export default async function CreatorGuard({ children }: CreatorGuardProps) {
  const access = await getLiveAccess();

  if (!access) {
    return redirectToSignIn();
  }

  if (!access.isCreator) {
    const t = await getT(shellMessages);
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h1 className="text-2xl font-heading font-bold text-fg mb-2">{t('guards.accessDenied')}</h1>
          <p className="text-fg-muted">{t('guards.creatorOnly')}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
