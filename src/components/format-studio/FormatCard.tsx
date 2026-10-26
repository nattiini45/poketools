import type { ReactNode } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';

interface FormatCardProps {
  href: string;
  title: string;
  /** Already-translated sentences under the title (summary, overview, coverage), in order. */
  lines: readonly string[];
  /** Badges row (format type, example label, error and warning counts). */
  badges?: ReactNode;
  /** Already-translated label of the open link, shown at the bottom of the card. */
  openLabel: string;
}

/**
 * One card of the Format Studio gallery (an example or a league). Presentational and hook-free, so a server page
 * renders it with strings it has already translated; the whole card is the link.
 */
export default function FormatCard({ href, title, lines, badges, openLabel }: FormatCardProps) {
  return (
    <Link href={href} className="block min-w-0">
      <Card hover className="h-full space-y-2">
        <h3 className="break-words font-heading font-semibold text-poke-text-primary">{title}</h3>
        {badges !== undefined && <div className="flex flex-wrap items-center gap-2">{badges}</div>}
        {lines.map((line, i) => (
          <p key={i} className="break-words text-sm text-poke-text-secondary">
            {line}
          </p>
        ))}
        <p className="text-sm font-medium text-poke-blue">{openLabel}</p>
      </Card>
    </Link>
  );
}
