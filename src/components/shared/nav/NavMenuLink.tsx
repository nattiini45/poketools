import Link from 'next/link';
import type { ReactNode } from 'react';
import { FOCUS_RING } from '@/components/ui/panel';
import { cn } from '@/lib/utils/cn';

/** One row of a nav menu (More, the account menu, the drawer, the bottom bar's sheet): icon, label, current page. */
export default function NavMenuLink({
  href,
  icon,
  active = false,
  onNavigate,
  children,
}: {
  href: string;
  icon: ReactNode;
  active?: boolean;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-poke-md px-2.5 text-body text-fg transition-colors duration-[80ms] lg:min-h-9',
        active ? 'bg-accent-subtle font-[550] text-accent-ink' : 'hover:bg-hover',
        FOCUS_RING,
      )}
    >
      <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center text-fg-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </Link>
  );
}
