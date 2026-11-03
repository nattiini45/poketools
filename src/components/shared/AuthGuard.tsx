import { requireLiveIdentityOrSignIn } from '@/lib/auth/redirect-to-sign-in';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Signed-in view gate that decides from the live read, never the token copy: a layout is not re-rendered on a client
 * navigation inside its segment, so a page's own guard is the only gate that runs for a revoked session.
 */
export default async function AuthGuard({ children }: AuthGuardProps) {
  await requireLiveIdentityOrSignIn();
  return <>{children}</>;
}
