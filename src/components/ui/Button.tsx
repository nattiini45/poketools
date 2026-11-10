"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Button as FluidButton } from "./fluid/button";
import { cn } from "@/lib/utils/cn";
import type { ButtonSize, ButtonVariant } from "./buttonStyles";

export { getButtonClasses } from "./buttonStyles";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: boolean;
}

const FLUID_VARIANT = {
  primary: "primary",
  secondary: "tertiary",
  ghost: "ghost",
  danger: "destructive",
  success: "primary",
} as const satisfies Record<ButtonVariant, string>;

const FLUID_SIZE = { sm: "compact", md: "default", lg: "default" } as const satisfies Record<ButtonSize, string>;

const FILL: Partial<Record<ButtonVariant, string>> = {
  primary: "[--foreground:var(--accent-fill)] [--background:var(--tier-ink)]",
  success: "[--foreground:var(--poke-green)] [--background:var(--poke-on-green)]",
};

/**
 * The site button on the @fluid button (docs/design.md, "Direction B primitives"). The props are the pre-redesign
 * ones; primary and success recolour @fluid's primary fill (amber accent fill with plate ink, green), secondary is
 * @fluid's bordered tertiary and danger its destructive wash. Frozen surfaces import ./frozen/Button instead.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading = false, asChild = false, className, ...props }, ref) => (
    <FluidButton
      ref={ref}
      variant={FLUID_VARIANT[variant]}
      size={FLUID_SIZE[size]}
      loading={loading}
      asChild={asChild}
      className={cn(FILL[variant], className)}
      {...props}
    />
  )
);

Button.displayName = "Button";
export default Button;
