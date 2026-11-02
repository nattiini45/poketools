"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "@/components/shared/motion";
import { DURATION, EASE, OFFSET, STAGGER } from "@/lib/motion/tokens";

function containerVariants(stagger: number): Variants {
  return {
    hidden: {},
    visible: { transition: { staggerChildren: stagger } },
  };
}

const ITEM_TRANSITION = { duration: DURATION.overlay, ease: EASE.out };

/** Under reduced motion the items only fade: no rise, and no stagger (see `AnimatedList`). */
const itemVariants: Variants = {
  hidden: { opacity: 0, y: OFFSET.md },
  visible: { opacity: 1, y: 0, transition: ITEM_TRANSITION },
};

const reducedItemVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: ITEM_TRANSITION },
};

interface AnimatedListProps {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
}

export function AnimatedList({
  children,
  className,
  staggerDelay,
}: AnimatedListProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const stagger = reduceMotion ? 0 : (staggerDelay ?? STAGGER.desktop);

  return (
    <motion.div
      variants={containerVariants(stagger)}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedListItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <motion.div variants={reduceMotion ? reducedItemVariants : itemVariants} className={className}>
      {children}
    </motion.div>
  );
}
