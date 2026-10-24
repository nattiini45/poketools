import { redirect } from 'next/navigation';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getT } from '@/i18n/server';
import { shellMessages } from '@/i18n/messages/shell';

interface SiteAdminGuardProps {
  children: React.ReactNode;
}

/**
 * Live view gate for pages only a site admin may open (what `requireAdmin()`
 * accepts). `AdminGuard` also lets resource admins in; this one does not.
 * Same live read and the same panel as `AdminGuard` (D37): a revoked admin
 * loses the page on the next render, not after the session TTL.
 */
export default async function SiteAdminGuard({ children }: SiteAdminGuardProps) {
  const access = await getLiveAccess();

  if (!access) {
    redirect('/api/auth/signin');
  }

  if (!access.isSiteAdmin) {
    const t = await getT(shellMessages);
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">{t('guards.accessDenied')}</h1>
          <p className="text-poke-text-secondary">{t('guards.siteAdminOnly')}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
