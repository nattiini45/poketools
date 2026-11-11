import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/** The "back to dashboard" link under the player's match pages. */
export default function MatchPageBackLink({ label }: { label: string }) {
  return (
    <Link
      href="/dashboard"
      className="inline-flex min-h-11 items-center gap-1.5 self-start text-body font-[550] text-accent-ink underline-offset-4 hover:underline sm:min-h-0"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );
}
