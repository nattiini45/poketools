"use client";

import { useState, useId, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "@/components/shared/motion";
import { cn } from "@/lib/utils/cn";
import { DURATION, EASE } from "@/lib/motion/tokens";
import type { ItemIconId } from "@/lib/pkmn/item-icons";
import ItemIcon from "./ItemIcon";

interface CollapsibleSectionProps {
  /** Anchor id on the outer <section>, so a link can jump to it. */
  id?: string;
  title?: string;
  /** An approved item icon (docs/design.md, "Item icons") left of the title; decorative, the title names the section. */
  icon?: ItemIconId;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  defaultCollapsed?: boolean;
  /**
   * Keep the body mounted (and `hidden`) while collapsed, so client state inside
   * it (a saving control, an unsaved draft) survives collapse and expand. Off by
   * default: a collapsed body is unmounted, so heavy sections fetch nothing until
   * they are opened. Turn it on for small settings controls.
   */
  keepMounted?: boolean;
}

export default function CollapsibleSection({
  id,
  title,
  icon,
  subtitle,
  action,
  children,
  className,
  defaultCollapsed = false,
  keepMounted = false,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const contentId = useId();
  const isOpen = !collapsed;
  // MotionConfig reducedMotion="user" only drops transform and layout animations;
  // a height tween still runs, so it is cut to zero here.
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <section
      id={id}
      className={cn(
        "self-start w-full bg-surface border border-hairline rounded-poke-lg shadow-poke-card overflow-hidden",
        id && "scroll-mt-4",
        className
      )}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-hairline">
          <button
            type="button"
            className="flex items-center gap-2 text-left min-w-0 cursor-pointer"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-expanded={isOpen}
            aria-controls={contentId}
          >
            {isOpen ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
            )}
            <div className="min-w-0">
              {title && (
                <div className="flex items-center gap-3">
                  {icon && <ItemIcon item={icon} size={24} />}
                  <h2 className="min-w-0 font-heading text-title text-fg">
                    {title}
                  </h2>
                </div>
              )}
              {subtitle && (
                <p className="mt-1 text-body text-fg-muted">
                  {subtitle}
                </p>
              )}
            </div>
          </button>
          {action && (
            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
              {action}
            </div>
          )}
        </div>
      )}
      {keepMounted ? (
        <div id={contentId} hidden={!isOpen}>
          <div className="p-5">{children}</div>
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              id={contentId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={
                reduceMotion
                  ? { height: { duration: DURATION.instant }, opacity: { duration: DURATION.state, ease: EASE.standard } }
                  : { duration: DURATION.state, ease: EASE.standard }
              }
              style={{ overflow: "hidden" }}
            >
              <div className="p-5">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </section>
  );
}
