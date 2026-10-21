import { cva, type VariantProps } from "class-variance-authority";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 border font-heading font-semibold transition-all duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
  {
    variants: {
      variant: {
        primary:
          "border-poke-accent bg-poke-accent text-poke-surface hover:border-poke-accent-strong hover:bg-poke-accent-strong shadow-poke-sm hover:shadow-poke-md active:shadow-none",
        secondary:
          "border-poke-border bg-poke-elevated text-poke-text-primary hover:border-poke-accent hover:bg-poke-muted shadow-poke-sm active:shadow-none",
        ghost:
          "border-transparent bg-transparent text-poke-text-secondary hover:bg-poke-elevated hover:text-poke-text-primary",
        danger:
          "border-poke-danger bg-poke-danger text-poke-on-danger hover:border-poke-danger-hover hover:bg-poke-danger-hover shadow-poke-sm hover:shadow-poke-md active:shadow-none",
        success:
          "border-poke-green bg-poke-green text-poke-on-green hover:border-poke-green-hover hover:bg-poke-green-hover shadow-poke-sm hover:shadow-poke-md active:shadow-none",
      },
      size: {
        sm: "px-3 py-1.5 text-sm rounded-poke-md",
        md: "px-4 py-2 text-sm rounded-poke-md",
        lg: "px-6 py-2.5 text-base rounded-poke-lg",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

/** @deprecated Use buttonVariants() via cn() instead */
export const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "border-poke-accent bg-poke-accent text-poke-surface hover:border-poke-accent-strong hover:bg-poke-accent-strong shadow-poke-sm hover:shadow-poke-md active:shadow-none",
  secondary:
    "border-poke-border bg-poke-elevated text-poke-text-primary hover:border-poke-accent hover:bg-poke-muted shadow-poke-sm active:shadow-none",
  ghost:
    "border-transparent bg-transparent text-poke-text-secondary hover:bg-poke-elevated hover:text-poke-text-primary",
  danger:
    "border-poke-danger bg-poke-danger text-poke-on-danger hover:border-poke-danger-hover hover:bg-poke-danger-hover shadow-poke-sm hover:shadow-poke-md active:shadow-none",
  success:
    "border-poke-green bg-poke-green text-poke-on-green hover:border-poke-green-hover hover:bg-poke-green-hover shadow-poke-sm hover:shadow-poke-md active:shadow-none",
};

/** @deprecated Use buttonVariants() via cn() instead */
export const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm rounded-poke-md",
  md: "px-4 py-2 text-sm rounded-poke-md",
  lg: "px-6 py-2.5 text-base rounded-poke-lg",
};

export function getButtonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md"
): string {
  return buttonVariants({ variant, size });
}
