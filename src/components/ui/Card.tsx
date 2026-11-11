import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

type CardVariant = "default" | "elevated" | "outlined" | "muted";

const cardVariants = cva("rounded-poke-lg border transition-[background-color,border-color] duration-80 ease-out", {
  variants: {
    variant: {
      default: "border-hairline bg-surface",
      elevated: "border-hairline bg-surface shadow-surface-2",
      outlined: "border-hairline bg-transparent",
      muted: "border-hairline bg-elevated",
    },
    padding: {
      none: "",
      sm: "p-3",
      md: "p-5",
      lg: "p-6",
    },
    hover: {
      true: "cursor-pointer hover:border-hairline-strong hover:bg-hover",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    padding: "md",
    hover: false,
  },
});

interface CardProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {
  variant?: CardVariant;
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

/**
 * The site's container card on Direction B's surfaces, with @fluid's 80 ms colour hover in place of the lift. The
 * @fluid Card in ./fluid/card is the clickable tile for new layouts; frozen surfaces import ./frozen/Card.
 */
const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", hover = false, padding = "md", className, children, ...props },
  ref
) {
  return (
    <div ref={ref} className={cn(cardVariants({ variant, padding, hover }), className)} {...props}>
      {children}
    </div>
  );
});

export default Card;
