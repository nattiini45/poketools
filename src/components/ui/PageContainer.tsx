import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface PageContainerProps {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "full";
}

const maxWidthStyles = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-7xl",
  full: "",
};

export default function PageContainer({
  title,
  subtitle,
  action,
  children,
  maxWidth = "xl",
}: PageContainerProps) {
  return (
    <div className={cn(maxWidthStyles[maxWidth], "mx-auto space-y-6")}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4">
          <div>
            {title && (
              <h1 className="text-2xl font-heading font-bold tracking-tight text-poke-text-primary">
                {title}
              </h1>
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
      {children}
    </div>
  );
}
