'use client';

import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react';
import Link from 'next/link';
import { LoaderCircle } from 'lucide-react';
import SkewPlate from '@/components/ui/SkewPlate';
import { cn } from '@/lib/utils/cn';

type PlateTone = 'primary' | 'secondary';

const SHELL =
  'inline-flex min-h-11 items-stretch text-body transition-[filter,translate] duration-80 ease-out hover:brightness-95 active:translate-y-px active:brightness-90 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none';
const PLATE = 'w-full px-5 py-2';

function label(children: ReactNode, loading: boolean) {
  return (
    <span className="inline-flex items-center justify-center gap-2 text-center">
      {loading && <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:hidden" />}
      {children}
    </span>
  );
}

interface PlateButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the amber plate of the page's main action. secondary: the surface plate beside it. */
  tone?: PlateTone;
  /** The request is in flight: the button is disabled and shows a spinner beside its label. */
  loading?: boolean;
}

/**
 * A page's primary or secondary action on Direction B's skewed plate (docs/design.md, "Skewed plates"): a real button
 * around `SkewPlate`, at the 44 px touch height, with the focus ring on the plate. Dense in-card actions stay on `Button`.
 */
const PlateButton = forwardRef<HTMLButtonElement, PlateButtonProps>(function PlateButton(
  { tone = 'primary', loading = false, disabled, className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cn(SHELL, className)} {...props}>
      <SkewPlate variant="button" tone={tone} className={PLATE}>
        {label(children, loading)}
      </SkewPlate>
    </button>
  );
});

export default PlateButton;

interface PlateLinkProps extends ComponentProps<typeof Link> {
  tone?: PlateTone;
}

/** The same plate around a link, for an action that navigates. */
export function PlateLink({ tone = 'primary', className, children, ...props }: PlateLinkProps) {
  return (
    <Link className={cn(SHELL, className)} {...props}>
      <SkewPlate variant="button" tone={tone} className={PLATE}>
        {label(children, false)}
      </SkewPlate>
    </Link>
  );
}
