"use client";

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import ItemIcon from '@/components/ui/ItemIcon';
import { AnimatePresence, motion, useReducedMotion } from '@/components/shared/motion';
import { DURATION, EASE } from '@/lib/motion/tokens';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { cn } from '@/lib/utils/cn';

interface ProfileSectionProps {
  title: string;
  children: ReactNode;
  defaultCollapsed?: boolean;
  /** The section's item icon (the approved map, `src/lib/pkmn/item-icons.ts`); without one the title carries the amber slash. */
  icon?: ItemIconId;
  /** A short count or state on the right of the header, e.g. "8 of 18 earned". */
  meta?: ReactNode;
}

/**
 * A profile section in Direction B: an item icon (or the skewed amber slash), a Geist Pixel title and a body that
 * collapses. The descendant overrides strip a child's own card chrome, so a composed panel sits flat inside the
 * section (pack extensions render their sections through this component too).
 */
export default function ProfileSection({ title, children, defaultCollapsed = false, icon, meta }: ProfileSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const contentId = useId();
  const isOpen = !collapsed;
  // MotionConfig reducedMotion="user" drops transforms only; the height tween is cut here.
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <section className="w-full self-start overflow-hidden rounded-poke-lg border border-hairline bg-surface">
      <h2>
        <button
          type="button"
          className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors duration-80 ease-out hover:bg-hover sm:px-5"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-expanded={isOpen}
          aria-controls={contentId}
        >
          {icon ? (
            <ItemIcon item={icon} />
          ) : (
            <span aria-hidden="true" className="h-5 w-1.5 shrink-0 rounded-[1px] bg-accent-fill [transform:skewX(var(--skew))]" />
          )}
          <span className="min-w-0 flex-1 font-heading text-title text-fg">{title}</span>
          {meta && <span className="shrink-0 text-caption text-fg-muted tabular-nums">{meta}</span>}
          <ChevronDown
            aria-hidden="true"
            className={cn('h-4 w-4 shrink-0 text-fg-muted transition-transform duration-160 ease-out motion-reduce:transition-none', isOpen && 'rotate-180')}
          />
        </button>
      </h2>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={contentId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              reduceMotion
                ? { height: { duration: DURATION.instant }, opacity: { duration: DURATION.state, ease: EASE.standard } }
                : { duration: DURATION.state, ease: EASE.standard }
            }
            style={{ overflow: 'hidden' }}
          >
            <div className="border-t border-hairline p-4 sm:p-5">
              <div className="[&>div]:bg-transparent [&>div]:border-0 [&>div]:shadow-none [&>div]:p-0 [&>div]:rounded-none [&>section]:bg-transparent [&>section]:border-0 [&>section]:shadow-none [&>section]:p-0 [&>section]:rounded-none">
                {children}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
