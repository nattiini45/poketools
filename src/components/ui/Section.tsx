import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import CollapsibleSection from "./CollapsibleSection";

interface SectionProps {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Collapsible only: keep the body mounted while collapsed (see `CollapsibleSection`). */
  keepMounted?: boolean;
}

export default function Section({
  title,
  subtitle,
  action,
  children,
  className,
  collapsible,
  defaultCollapsed,
  keepMounted,
}: SectionProps) {
  if (collapsible) {
    return (
      <CollapsibleSection
        title={title}
        subtitle={subtitle}
        action={action}
        className={className}
        defaultCollapsed={defaultCollapsed}
        keepMounted={keepMounted}
      >
        {children}
      </CollapsibleSection>
    );
  }

  return (
    <section
      className={cn(
        "self-start w-full bg-poke-surface border border-poke-border rounded-poke-lg shadow-poke-card overflow-hidden",
        className
      )}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-poke-border bg-poke-elevated/50">
          <div>
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
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
