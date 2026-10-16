import type { ReactNode } from 'react';
import { RevealGroup, RevealItem } from '@/components/world/Reveal';

interface SectionShellProps {
  /** Stable section id — used as the anchor target by WorldNav. */
  id: string;
  /** Accessible heading text for the section. */
  heading: string;
  /** Heading level — defaults to h2 under a page h1. */
  headingLevel?: 2 | 3;
  children: ReactNode;
  /**
   * Content after the revealed body, outside the reveal choreography: still
   * inside the <section> (so the route-live paint rules apply), but never held
   * at opacity 0 by the group's 15% in-view threshold, which a body taller
   * than about 6.7 viewports can never reach (the league hub in #pulse).
   */
  after?: ReactNode;
  className?: string;
}

/**
 * Semantic `<section id>` wrapper with consistent vertical rhythm,
 * `scroll-margin-top` so the sticky anchor nav never covers section tops,
 * and an accessible heading slot (`aria-labelledby` on the section).
 *
 * Server-component compatible. The reveal choreography lives in the client
 * `Reveal` primitives, which pass children through untouched — heading first,
 * body one stagger beat later.
 */
export default function SectionShell({
  id,
  heading,
  headingLevel = 2,
  children,
  after,
  className = '',
}: SectionShellProps) {
  const headingId = `${id}-heading`;
  const Tag = headingLevel === 3 ? 'h3' : 'h2';

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`scroll-mt-24 py-10 first:pt-2 ${className}`}
    >
      <RevealGroup>
        <RevealItem>
          <Tag
            id={headingId}
            className="font-heading text-2xl font-bold tracking-tight text-arena-ink"
          >
            {heading}
          </Tag>
          <div aria-hidden="true" className="mt-2 h-0.5 w-12 rounded-full bg-arena-accent" />
        </RevealItem>
        <RevealItem className="mt-6">{children}</RevealItem>
      </RevealGroup>
      {after}
    </section>
  );
}
