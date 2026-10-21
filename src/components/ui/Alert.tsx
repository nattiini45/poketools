import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type AlertVariant = "error" | "success" | "warning" | "info";

const alertVariants = cva(
  "relative w-full rounded-poke-md border px-3 py-2 text-sm font-heading",
  {
    variants: {
      variant: {
        error: "bg-poke-danger-light border-poke-danger/20 text-poke-danger",
        success: "bg-poke-green-light border-poke-green/20 text-poke-green",
        warning: "bg-poke-yellow-light border-poke-yellow/20 text-poke-yellow-ink",
        info: "bg-poke-blue-light border-poke-blue/20 text-poke-blue",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
);

interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  variant: AlertVariant;
}

export default function Alert({
  variant,
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {children}
    </div>
  );
}
