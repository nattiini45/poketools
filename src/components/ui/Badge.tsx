import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type BadgeVariant =
  | "default"
  | "accent"
  | "red"
  | "blue"
  | "green"
  | "yellow"
  | "purple"
  | "gray";
type BadgeSize = "xs" | "sm" | "md";

const badgeVariants = cva(
  "inline-flex items-center border font-heading font-semibold rounded-full",
  {
    variants: {
      variant: {
        default: "border-poke-border bg-poke-muted text-poke-text-secondary",
        accent: "border-poke-accent/30 bg-poke-accent-light text-poke-accent",
        red: "border-poke-danger/30 bg-poke-danger-light text-poke-danger",
        blue: "border-poke-blue/30 bg-poke-blue-light text-poke-blue dark:border-poke-blue/40",
        green: "border-poke-green/30 bg-poke-green-light text-poke-green",
        yellow: "border-poke-yellow/40 bg-poke-yellow-light text-poke-yellow-ink",
        purple: "border-poke-plum/30 bg-poke-plum-light text-poke-plum",
        gray: "border-poke-border bg-poke-muted text-poke-text-muted",
      },
      size: {
        xs: "px-1.5 py-px text-[10px]",
        sm: "px-2 py-0.5 text-xs",
        md: "px-2.5 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
);

interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

export default function Badge({
  variant = "default",
  size = "sm",
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {children}
    </span>
  );
}
