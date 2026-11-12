'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import type { ButtonSize, ButtonVariant } from '@/components/ui/buttonStyles';

/**
 * A link that looks like the site button. A client leaf, because `Button asChild` has to see its child element: a
 * child handed over from a server component arrives as a lazy reference and would render a `<button>` on the server.
 * `external` opens a plain anchor in a new tab; `reload` is a plain anchor in the same tab (a full GET, as a form
 * reset link needs); otherwise it is a client-side `Link`.
 */
export default function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  external = false,
  reload = false,
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  external?: boolean;
  reload?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      {external ? (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      ) : reload ? (
        <a href={href}>{children}</a>
      ) : (
        <Link href={href}>{children}</Link>
      )}
    </Button>
  );
}
