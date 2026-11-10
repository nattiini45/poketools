import { type CSSProperties, type HTMLAttributes } from "react";
import { Badge as FluidBadge } from "./fluid/badge";

type BadgeVariant = "default" | "accent" | "red" | "blue" | "green" | "yellow" | "purple" | "gray";
type BadgeSize = "xs" | "sm" | "md";

interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "color"> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

const STATUS_COLOR: Partial<Record<BadgeVariant, CSSProperties>> = {
  accent: { backgroundColor: "var(--accent-subtle)", color: "var(--accent-ink)" },
  red: { backgroundColor: "var(--loss-bg)", color: "var(--loss)" },
  green: { backgroundColor: "var(--win-bg)", color: "var(--win)" },
  blue: { backgroundColor: "color-mix(in srgb, var(--poke-blue) 15%, var(--background))", color: "var(--poke-blue)" },
  yellow: { backgroundColor: "color-mix(in srgb, var(--poke-yellow) 15%, var(--background))", color: "var(--poke-yellow-ink)" },
  purple: { backgroundColor: "color-mix(in srgb, var(--poke-plum) 15%, var(--background))", color: "var(--poke-plum)" },
};

const FLUID_SIZE = { xs: "compact", sm: "compact", md: "default" } as const satisfies Record<BadgeSize, string>;

/**
 * The site badge on the @fluid solid badge, tinted with the direction B status colours (docs/design.md): win and
 * loss for green and red, the poke-* status hue mixed 15 % into the ground under its ink for blue, yellow and purple
 * (the -light tints vanish on the sunlit ground), accent-subtle for accent, the neutral fill for default and gray.
 * Frozen surfaces import ./frozen/Badge instead.
 */
export default function Badge({ variant = "default", size = "sm", style, ...props }: BadgeProps) {
  return (
    <FluidBadge variant="solid" color="gray" size={FLUID_SIZE[size]} style={{ ...STATUS_COLOR[variant], ...style }} {...props} />
  );
}
