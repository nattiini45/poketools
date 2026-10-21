import { redirect } from 'next/navigation';
import NavBar from '@/components/shared/NavBar';
import PageTransitionWrapper from '@/components/shared/PageTransitionWrapper';
import { getSession } from '@/lib/auth/helpers';
import { siteNavExtraLinks } from '@/lib/pack-extensions';

export default async function PlayerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  if (!session) {
    redirect('/api/auth/signin');
  }
  const navExtraLinks = await siteNavExtraLinks();

  return (
    <>
      <NavBar extraLinks={navExtraLinks} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <PageTransitionWrapper>{children}</PageTransitionWrapper>
      </main>
    </>
  );
}
