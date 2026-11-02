import { getSessionPlayer } from '@/lib/auth/helpers';
import { siteNavExtraLinks } from '@/lib/pack-extensions';
import CreatorNav from '@/components/creator/CreatorNav';
import NavBar from '@/components/shared/NavBar';
import SkipToContent from '@/components/shared/SkipToContent';
import { MAIN_CONTENT_ID } from '@/lib/ui/main-content';
import PageTransitionWrapper from '@/components/shared/PageTransitionWrapper';

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
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 focus:outline-none">
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
