'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { signInPath } from '@/lib/auth/safe-callback-url';

/**
 * The sign-in page URL that returns to the page being viewed, query included (issue #56). Reads `useSearchParams`, so a
 * caller renders inside `<Suspense>` with a bare `/auth/signin` fallback. The sign-in and other `/auth/*` pages get no
 * `callbackUrl` (see `signInPath`).
 */
export function useSignInHref(): string {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  return signInPath(pathname ? `${pathname}${search ? `?${search}` : ''}` : null);
}
