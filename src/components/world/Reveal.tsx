'use client';

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { motion, useMotionValue, useReducedMotion, type Variants } from '@/components/shared/motion';
import { DURATION, EASE, OFFSET, STAGGER } from '@/lib/motion/tokens';

/** Same 767 breakpoint the route conductor uses for mobile camera endpoints. */
const MOBILE_QUERY = '(max-width: 767px)';

function subscribeMobile(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getMobile(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getDesktopSnapshot(): boolean {
  return false;
}

/**
 * Scroll-triggered entrance choreography for world sections.
 *
 * `RevealGroup` owns the stagger; `RevealItem` owns one beat. Children are
 * passed through untouched, so a server component can wrap server-rendered
 * markup in these without becoming a client component itself.
 *
 * Under `prefers-reduced-motion` both collapse to an opacity cross-fade with
 * no translation and no stagger — content still announces itself, it just
 * stops moving. Each group animates once; scrolling back up does not replay.
 *
 * Direction of travel (bar W6): an item enters moving WITH the scroll. One
 * that starts below the viewport rises into view as the visitor scrolls
 * down; one that starts ABOVE the viewport (a deep link or reload mid-page)
 * can only be reached by scrolling up, so it drops in from above instead of
 * rising against the gesture. The side is read once, at mount, before the
 * item can be in view — reveals are one-shot, so it never needs updating.
 */

interface RevealProps {
  children: ReactNode;
  className?: string;
}

function groupVariants(reduced: boolean, mobile: boolean): Variants {
  return {
    hidden: {},
    show: {
      transition: {
        staggerChildren: reduced ? 0 : mobile ? STAGGER.mobile : STAGGER.desktop,
      },
    },
  };
}

/**
 * Whether the element sits entirely above the viewport. One with no box
 * (mounted under `display: none`) reads an all-zero rect — not above, so it
 * keeps the default rise (Kilo, PR #65).
 */
export function startsAboveViewport(element: Pick<Element, 'getClientRects' | 'getBoundingClientRect'>): boolean {
  return element.getClientRects().length > 0 && element.getBoundingClientRect().bottom <= 0;
}

/**
 * Vertical entry offset driven by where the item sits at mount: +offset
 * (rises into view) normally, −offset when the item is entirely above the
 * viewport. `y` is a motion value the `show` variant animates to 0; the
 * `hidden` variant leaves it alone so the measured side is not overwritten.
 */
function useTravelOffset(reduced: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const y = useMotionValue(reduced ? 0 : OFFSET.md);

  useLayoutEffect(() => {
    // Reduced motion resolves after hydration: drop any offset (the item is
    // still hidden, so the change is invisible).
    if (reduced) {
      y.set(0);
      return;
    }
    const element = ref.current;
    if (element && startsAboveViewport(element)) y.set(-OFFSET.md);
  }, [reduced, y]);

  return { ref, y };
}

function itemVariants(reduced: boolean): Variants {
  return {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reduced ? DURATION.state : DURATION.section,
        ease: EASE.out,
      },
    },
  };
}

/** Staggering parent. Triggers once when ~15% of the group is on screen. */
export function RevealGroup({ children, className }: RevealProps) {
  const reduced = useReducedMotion() ?? false;
  const mobile = useSyncExternalStore(subscribeMobile, getMobile, getDesktopSnapshot);

  return (
    <motion.div
      className={className}
      variants={groupVariants(reduced, mobile)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15 }}
    >
      {children}
    </motion.div>
  );
}

/** One beat inside a `RevealGroup`. */
export function RevealItem({ children, className }: RevealProps) {
  const reduced = useReducedMotion() ?? false;
  const { ref, y } = useTravelOffset(reduced);

  return (
    <motion.div ref={ref} className={className} style={{ y }} variants={itemVariants(reduced)}>
      {children}
    </motion.div>
  );
}

/** Standalone single-beat reveal for content with no siblings to stagger. */
export default function Reveal({ children, className }: RevealProps) {
  const reduced = useReducedMotion() ?? false;
  const { ref, y } = useTravelOffset(reduced);

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ y }}
      variants={itemVariants(reduced)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15 }}
    >
      {children}
    </motion.div>
  );
}
