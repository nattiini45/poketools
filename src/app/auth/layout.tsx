import type { Metadata } from 'next';
import Link from 'next/link';
import { NOINDEX } from '@/lib/seo/robots';
import { MAIN_CONTENT_ID } from '@/lib/ui/main-content';

export const metadata: Metadata = { robots: NOINDEX };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12 focus:outline-2 focus:outline-offset-2 focus:outline-transparent"
    >
      {/* The versus slab of the character-select screen: one sheared column of arena sand with an amber edge. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-[min(34rem,72vw)] border-r-[6px] border-accent-fill bg-sunken [transform:translateX(-50%)_skewX(var(--skew))]"
      />
      <Link href="/" className="mb-6 inline-flex items-center gap-2.5 font-heading text-display text-fg">
        <span aria-hidden="true" className="h-6 w-2.5 rounded-[2px] bg-accent-fill [transform:skewX(var(--skew))]" />
        {/* i18n-ignore: brand wordmark (PokéTools), the same in every language */}
        PokéTools
      </Link>
      <div className="flex w-full max-w-md flex-col gap-4">{children}</div>
    </main>
  );
}
