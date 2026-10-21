import { redirect } from 'next/navigation';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getT } from '@/i18n/server';
import { shellMessages } from '@/i18n/messages/shell';

interface AdminGuardProps {
  children: React.ReactNode;
}

/**
 * Live view gate (D37): decides from the live player row, not the session
 * copy, so a revoked admin loses the admin pages on the next render instead
 * of after the 5-minute session TTL. One memoised read per render, shared
 * with the admin layout.
 */
export default async function AdminGuard({ children }: AdminGuardProps) {
  const access = await getLiveAccess();

  if (!access) {
    redirect('/api/auth/signin');
  }

  if (!access.isAnyAdmin) {
    const t = await getT(shellMessages);
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">{t('guards.accessDenied')}</h1>
          <p className="text-poke-text-secondary">{t('guards.adminOnly')}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
