import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import type { ItemIconId } from "@/lib/pkmn/item-icons";
import ItemIcon from "./ItemIcon";

interface PageContainerProps {
  title?: string;
  /** An approved item icon (docs/design.md, "Item icons") left of the title; decorative, the title names the page. */
  icon?: ItemIconId;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "full";
}

const maxWidthStyles = {
  sm: "max-w-[756px]",
  md: "max-w-[1008px]",
  lg: "max-w-[1152px]",
  xl: "max-w-[1440px]",
  full: "",
};

export default function PageContainer({
  title,
  icon,
  subtitle,
  action,
  children,
  maxWidth = "xl",
}: PageContainerProps) {
  const hasTitleBlock = Boolean(title || subtitle);
  return (
    <div className={cn(maxWidthStyles[maxWidth], "mx-auto space-y-[27px]")}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          {hasTitleBlock && (
            <div className="min-w-0 flex-1 basis-60">
              {title && (
                <div className="flex items-center gap-3">
                  {icon && <ItemIcon item={icon} size={48} />}
                  <h1 className="min-w-0 font-heading text-display text-balance text-fg">
                    {title}
                  </h1>
                </div>
              )}
              {subtitle && (
                <p className="mt-2 text-body text-fg-muted">
                  {subtitle}
                </p>
              )}
            </div>
          )}
          {action && (
            <div className={cn("max-w-full min-w-0", !hasTitleBlock && "ml-auto")}>
              {action}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
