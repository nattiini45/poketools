import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

type CardVariant = "default" | "elevated" | "outlined" | "muted";

const cardVariants = cva(
  "rounded-poke-lg transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out",
  {
    variants: {
      variant: {
        default: "bg-poke-surface border border-poke-border shadow-poke-card",
        elevated: "bg-poke-surface border border-poke-border shadow-poke-md",
        outlined: "bg-transparent border border-poke-border",
        muted: "bg-poke-elevated border border-poke-border",
      },
      padding: {
        none: "",
        sm: "p-3",
        md: "p-5",
        lg: "p-6",
      },
      hover: {
        true: "cursor-pointer hover:-translate-y-0.5 hover:border-poke-accent hover:shadow-poke-card-hover motion-reduce:transform-none motion-reduce:transition-none",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      padding: "md",
      hover: false,
    },
  }
);

interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  variant?: CardVariant;
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    variant = "default",
    hover = false,
    padding = "md",
    className,
    children,
    ...props
  },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, padding, hover }), className)}
      {...props}
    >
      {children}
    </div>
  );
});

export default Card;
