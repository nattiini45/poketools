import type { ReactNode } from 'react';
import Link from 'next/link';
import SkewPlate from '@/components/ui/SkewPlate';

interface PlateLinkProps {
  href: string;
  children: ReactNode;
  tone?: 'primary' | 'secondary';
}

/** A link drawn as Direction B's skewed button plate (the amber primary or the surface secondary), 44 px tall for touch. */
export default function PlateLink({ href, children, tone = 'secondary' }: PlateLinkProps) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 transition-transform duration-80 ease-out hover:-translate-y-px active:translate-y-0 motion-reduce:transform-none"
    >
      <SkewPlate variant="button" tone={tone} className="min-h-11 px-4 text-body">
        <span className="inline-flex items-center gap-2">{children}</span>
      </SkewPlate>
    </Link>
  );
}
