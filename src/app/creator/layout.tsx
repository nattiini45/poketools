import type { Metadata } from 'next';
import { NOINDEX } from '@/lib/seo/robots';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { siteNavExtraLinks } from '@/lib/pack-extensions';
import CreatorNav from '@/components/creator/CreatorNav';
import NavBar from '@/components/shared/NavBar';
import SkipToContent from '@/components/shared/SkipToContent';
import { MAIN_CONTENT_ID } from '@/lib/ui/main-content';
import PageTransitionWrapper from '@/components/shared/PageTransitionWrapper';

export const metadata: Metadata = { robots: NOINDEX };

export default async function CreatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [player, navExtraLinks] = await Promise.all([getSessionPlayer(), siteNavExtraLinks()]);

  return (
    <>
      <SkipToContent />
      <NavBar extraLinks={navExtraLinks} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="max-w-[1440px] mx-auto px-[18px] sm:px-[27px] lg:px-[36px] py-[27px] focus:outline-2 focus:outline-offset-2 focus:outline-transparent">
        <PageTransitionWrapper>
          <section className="space-y-4">
            <CreatorNav playerName={player?.name} />
            {children}
          </section>
        </PageTransitionWrapper>
      </main>
    </>
  );
}
