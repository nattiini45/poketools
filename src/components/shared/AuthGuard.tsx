import { redirectToSignIn } from '@/lib/auth/redirect-to-sign-in';
import { getSession } from '@/lib/auth/helpers';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default async function AuthGuard({ children }: AuthGuardProps) {
  const session = await getSession();

  if (!session) {
    return redirectToSignIn();
  }

  return <>{children}</>;
}
