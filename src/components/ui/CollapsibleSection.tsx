"use client";

import { useState, useId, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "@/components/shared/motion";
import { cn } from "@/lib/utils/cn";

interface CollapsibleSectionProps {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  defaultCollapsed?: boolean;
}

export default function CollapsibleSection({
  title,
  subtitle,
  action,
  children,
  className,
  defaultCollapsed = false,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const contentId = useId();
  const isOpen = !collapsed;

  return (
    <section
      className={cn(
        "self-start w-full bg-poke-surface border border-poke-border rounded-poke-lg shadow-poke-card overflow-hidden",
        className
      )}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-poke-border bg-poke-elevated/50">
          <button
            type="button"
            className="flex items-center gap-2 text-left min-w-0 cursor-pointer"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-expanded={isOpen}
            aria-controls={contentId}
          >
            {isOpen ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-poke-text-muted" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-poke-text-muted" aria-hidden="true" />
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="text-lg font-heading font-bold tracking-tight text-poke-text-primary">
                  {title}
                </h2>
              )}
              {title && (
                <div
                  aria-hidden="true"
                  className="mt-2 h-0.5 w-12 rounded-full bg-poke-accent"
                />
              )}
              {subtitle && (
                <p className="mt-2 text-sm text-poke-text-secondary">
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
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={contentId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div className="p-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
