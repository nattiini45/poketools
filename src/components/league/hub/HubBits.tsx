import Link from 'next/link';
import type { ReactNode } from 'react';
import { FOCUS_RING, PANEL_NOTICE } from '@/components/world/panel';

/**
 * Small server-rendered pieces the league hub panels share. Everything is
 * styled with the arena tokens, so the hub takes the palette of whichever
 * world it sits in (plaza, park, pass, sky island), in both themes.
 */

/** A phase or season status chip: live ink while running, accent before, quiet after. */
export function HubStatusChip({ status, label }: { status: string; label: string }) {
  const tone =
    status === 'active' || status === 'in_progress'
      ? 'border-arena-live text-arena-live'
      : status === 'upcoming' || status === 'pending' || status === 'scheduled'
        ? 'border-arena-accent text-arena-accent-strong'
        : status === 'disputed' || status === 'pending_confirmation'
          ? 'border-arena-accent-strong text-arena-accent-strong'
          : 'border-arena-border text-arena-ink-secondary';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      {(status === 'active' || status === 'in_progress') && (
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-arena-live motion-safe:animate-pulse" />
      )}
      {label}
    </span>
  );
}

/** The quiet empty state every panel uses. */
export function HubNotice({ children }: { children: ReactNode }) {
  return <p className={PANEL_NOTICE}>{children}</p>;
}

/** An inline text link in the hub's ink. */
export function HubLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`text-sm font-semibold text-arena-accent-strong underline-offset-2 hover:underline ${FOCUS_RING}`}
    >
      {children}
    </Link>
  );
}

/**
 * A phase heading row: name, kind, status and the link to the phase page,
 * where the phase's own tabs (rounds, stats, ruleset) live.
 */
export function HubStageHeader({
  name,
  meta,
  status,
  statusLabel,
  href,
  linkLabel,
}: {
  name: string;
  meta: string;
  status: string;
  statusLabel: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h4 className="font-heading text-lg font-bold text-arena-ink">{name}</h4>
        <p className="text-xs text-arena-ink-secondary">{meta}</p>
      </div>
      <div className="flex items-center gap-3">
        <HubStatusChip status={status} label={statusLabel} />
        <HubLink href={href}>
          {linkLabel}
          <span aria-hidden="true"> →</span>
        </HubLink>
      </div>
    </div>
  );
}
