import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import SkewPlate from '@/components/ui/SkewPlate';
import { cn } from '@/lib/utils/cn';

const LIFT =
  'inline-flex shrink-0 cursor-pointer transition-transform duration-80 ease-out hover:-translate-y-px active:translate-y-0 motion-reduce:transform-none';
const PLATE = 'min-h-11 px-4 text-body';

interface PlateLinkProps {
  href: string;
  children: ReactNode;
  tone?: 'primary' | 'secondary';
  className?: string;
}

/** A link drawn as Direction B's skewed button plate (the amber primary or the surface secondary), 44 px tall for touch. */
export function PlateLink({ href, children, tone = 'primary', className }: PlateLinkProps) {
  return (
    <Link href={href} className={cn(LIFT, className)}>
      <SkewPlate variant="button" tone={tone} className={PLATE}>
        <span className="inline-flex items-center gap-2">{children}</span>
      </SkewPlate>
    </Link>
  );
}

interface PlateButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'secondary';
}

/** The same plate on a button, for the primary action of a form or a save bar. */
export function PlateButton({ tone = 'primary', className, children, type = 'button', ...props }: PlateButtonProps) {
  return (
    <button
      type={type}
      className={cn(LIFT, 'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0', className)}
      {...props}
    >
      <SkewPlate variant="button" tone={tone} className={PLATE}>
        <span className="inline-flex items-center gap-2">{children}</span>
      </SkewPlate>
    </button>
  );
}
