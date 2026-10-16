import { redirect } from 'next/navigation';
import NavBar from '@/components/shared/NavBar';
import PageTransitionWrapper from '@/components/shared/PageTransitionWrapper';
import { getSession } from '@/lib/auth/helpers';

export default async function PlayerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  if (!session) {
    redirect('/api/auth/signin');
  }

  return (
    <>
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <PageTransitionWrapper>{children}</PageTransitionWrapper>
      </main>
    </>
  );
}
