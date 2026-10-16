"use client";

/**
 * Barrel export for the motion library.
 * Import from here instead of `motion/react` directly — keeps the import path
 * consistent and makes it easy to swap or tree-shake later.
 *
 * Preset timings come from `src/lib/motion/tokens.ts`; never hard-code a
 * duration or easing curve here or in a consumer. See `docs/design.md` §
 * Motion.
 */
export {
  motion,
  AnimatePresence,
  useAnimation,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Variants,
} from "motion/react";

import { DURATION, EASE, OFFSET, STAGGER } from "@/lib/motion/tokens";

/** Reusable animation presets */
export const fadeIn = {
  initial: { opacity: 0, y: OFFSET.sm },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: DURATION.state, ease: EASE.out },
} as const;

export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: STAGGER.desktop,
    },
  },
} as const;

export const staggerItem = {
  initial: { opacity: 0, y: OFFSET.md },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DURATION.overlay, ease: EASE.out },
} as const;

export const slideInRight = {
  initial: { x: "100%" },
  animate: { x: 0 },
  exit: { x: "100%" },
  transition: { type: "spring", damping: 25, stiffness: 300 },
} as const;
