import type { Metadata } from 'next';
import { NOINDEX } from '@/lib/seo/robots';
import { requireLiveIdentityOrSignIn } from '@/lib/auth/redirect-to-sign-in';
import NavBar from '@/components/shared/NavBar';
import SkipToContent from '@/components/shared/SkipToContent';
import { MAIN_CONTENT_ID } from '@/lib/ui/main-content';
import PageTransitionWrapper from '@/components/shared/PageTransitionWrapper';
import { siteNavExtraLinks } from '@/lib/pack-extensions';

export const metadata: Metadata = { robots: NOINDEX };

export default async function PlayerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireLiveIdentityOrSignIn();
  const navExtraLinks = await siteNavExtraLinks();

  return (
    <>
      <SkipToContent />
      <NavBar extraLinks={navExtraLinks} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 focus:outline-none">
        <PageTransitionWrapper>{children}</PageTransitionWrapper>
      </main>
    </>
  );
}
