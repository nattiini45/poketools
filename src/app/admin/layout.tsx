import NavBar from '@/components/shared/NavBar';
import PageTransitionWrapper from '@/components/shared/PageTransitionWrapper';
import AdminGuard from '@/components/shared/AdminGuard';
import AdminSidebar from '@/components/admin/AdminSidebar';
import { getLiveAccess, getSession, isSuperadmin } from '@/lib/auth/helpers';
import { extensionAdminLinks, siteNavExtraLinks } from '@/lib/pack-extensions';

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // D37: the site-admin flag comes from the live row (one memoised read,
  // shared with AdminGuard below), not the up-to-5-minute-old session copy.
  // The superadmin identity is configuration, so the session decides it.
  const [session, access, extraItems, navExtraLinks] = await Promise.all([
    getSession(),
    getLiveAccess(),
    // Admin pages of the active pack extension; a failing provider propagates (never fails open).
    extensionAdminLinks(),
    siteNavExtraLinks(),
  ]);
  const roles = {
    isSiteAdmin: access?.isSiteAdmin ?? false,
    isSuperadmin: isSuperadmin(session),
  };

  return (
    <>
      <NavBar extraLinks={navExtraLinks} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* The guard owns the sidebar's visibility: non-admins must not see
            the admin IA rail (the per-page AdminGuards remain as
            defense-in-depth for the content column). */}
        <AdminGuard>
          {/* Below lg the sidebar renders its chip-row nav, which must stack
              above the content: side by side, the chip rows' intrinsic width
              squeezed the content column to zero and widened the page. */}
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
            <AdminSidebar roles={roles} extraItems={extraItems} />
            <div className="min-w-0 lg:flex-1">
              <PageTransitionWrapper>{children}</PageTransitionWrapper>
            </div>
          </div>
        </AdminGuard>
      </main>
    </>
  );
}
