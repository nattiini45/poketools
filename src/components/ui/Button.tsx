"use client";

import { Children, forwardRef, isValidElement, type ButtonHTMLAttributes, type ReactNode } from "react";
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

const INLINE_CHILDREN = "[&>span>span]:inline-flex [&>span>span]:items-center [&>span>span]:gap-[inherit]";

const FILL: Partial<Record<ButtonVariant, string>> = {
  primary: "[--foreground:var(--accent-fill)] [--background:var(--tier-ink)]",
  success: "[--foreground:var(--poke-green)] [--background:var(--poke-on-green)]",
};

/**
 * The site button on the @fluid button (docs/design.md, "Direction B primitives"). The props are the pre-redesign
 * ones; primary and success recolour @fluid's primary fill (amber accent fill with plate ink, green), secondary is
 * @fluid's bordered tertiary and danger its destructive wash. @fluid wraps the label in one span for its text trim,
 * so a label that carries an icon element lays that span out as a row. Frozen surfaces import ./frozen/Button instead.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading = false, asChild = false, className, children, ...props }, ref) => {
    const label = asChild && isValidElement<{ children?: ReactNode }>(children) ? children.props.children : children;
    const hasElements = Children.toArray(label).some(isValidElement);
    return (
      <FluidButton
        ref={ref}
        variant={FLUID_VARIANT[variant]}
        size={FLUID_SIZE[size]}
        loading={loading}
        asChild={asChild}
        className={cn(FILL[variant], hasElements && INLINE_CHILDREN, className)}
        {...props}
      >
        {children}
      </FluidButton>
    );
  }
);

Button.displayName = "Button";
export default Button;
