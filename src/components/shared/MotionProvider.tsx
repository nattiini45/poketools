"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "@/components/shared/motion";

/**
 * The app's single `MotionConfig`: for a viewer who asked their OS for reduced motion, motion drops transform and
 * layout animations and keeps opacity, which is the rule in docs/design.md ("Motion"). Mounted once in the root
 * layout; broadcast overlays use no motion primitives, so they keep following the caster's `anim=` option.
 */
export default function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
