import { getSessionPlayer } from '@/lib/auth/helpers';
import { siteNavExtraLinks } from '@/lib/pack-extensions';
import CreatorNav from '@/components/creator/CreatorNav';
import NavBar from '@/components/shared/NavBar';
import PageTransitionWrapper from '@/components/shared/PageTransitionWrapper';

export default async function CreatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [player, navExtraLinks] = await Promise.all([getSessionPlayer(), siteNavExtraLinks()]);

  return (
    <>
      <NavBar extraLinks={navExtraLinks} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
