import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/helpers';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default async function AuthGuard({ children }: AuthGuardProps) {
  const session = await getSession();

  if (!session) {
    redirect('/auth/signin');
  }

  return <>{children}</>;
}
