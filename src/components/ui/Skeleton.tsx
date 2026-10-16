import { cn } from "@/lib/utils/cn";

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
  rounded?: "sm" | "md" | "lg" | "full";
}

const roundedStyles = {
  sm: "rounded-poke-sm",
  md: "rounded-poke-md",
  lg: "rounded-poke-lg",
  full: "rounded-full",
};

export default function Skeleton({
  className,
  width,
  height,
  rounded = "md",
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "bg-gradient-to-r from-poke-muted via-poke-elevated to-poke-muted bg-[length:200%_100%] animate-shimmer",
        roundedStyles[rounded],
        className
      )}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
