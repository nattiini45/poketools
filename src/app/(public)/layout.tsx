import NavBar from '@/components/shared/NavBar';
import SkipToContent from '@/components/shared/SkipToContent';
import { MAIN_CONTENT_ID } from '@/lib/ui/main-content';
import PageTransitionWrapper from '@/components/shared/PageTransitionWrapper';
import { siteNavExtraLinks } from '@/lib/pack-extensions';

export default async function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const navExtraLinks = await siteNavExtraLinks();
  return (
    <>
      <SkipToContent />
      <NavBar extraLinks={navExtraLinks} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="max-w-[1440px] mx-auto px-[18px] sm:px-[27px] lg:px-[36px] py-[27px] focus:outline-2 focus:outline-offset-2 focus:outline-transparent">
        <PageTransitionWrapper>{children}</PageTransitionWrapper>
      </main>
    </>
  );
}
