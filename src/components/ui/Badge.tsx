import { type HTMLAttributes } from "react";
import { Badge as FluidBadge } from "./fluid/badge";

type BadgeVariant = "default" | "accent" | "red" | "blue" | "green" | "yellow" | "purple" | "gray";
type BadgeSize = "xs" | "sm" | "md";

interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "color"> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

const FLUID_COLOR = {
  default: "gray",
  accent: "accent",
  red: "red",
  blue: "blue",
  green: "green",
  yellow: "amber",
  purple: "purple",
  gray: "gray",
} as const satisfies Record<BadgeVariant, string>;

const FLUID_SIZE = { xs: "compact", sm: "compact", md: "default" } as const satisfies Record<BadgeSize, string>;

/** The site badge on the @fluid solid badge; frozen surfaces import ./frozen/Badge instead. */
export default function Badge({ variant = "default", size = "sm", ...props }: BadgeProps) {
  return <FluidBadge variant="solid" color={FLUID_COLOR[variant]} size={FLUID_SIZE[size]} {...props} />;
}
