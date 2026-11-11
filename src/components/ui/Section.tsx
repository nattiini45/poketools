import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import type { ItemIconId } from "@/lib/pkmn/item-icons";
import CollapsibleSection from "./CollapsibleSection";
import ItemIcon from "./ItemIcon";

interface SectionProps {
  /** Anchor id on the outer <section>, so a link can jump to it. */
  id?: string;
  title?: string;
  /** An approved item icon (docs/design.md, "Item icons") left of the title; decorative, the title names the section. */
  icon?: ItemIconId;
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
  id,
  title,
  icon,
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
        id={id}
        title={title}
        icon={icon}
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
      id={id}
      className={cn(
        "self-start w-full bg-poke-surface border border-poke-border rounded-poke-lg shadow-poke-card overflow-hidden",
        id && "scroll-mt-4",
        className
      )}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-poke-border">
          <div>
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
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
