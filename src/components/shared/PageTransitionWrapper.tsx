"use client";

import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "@/components/shared/motion";
import { pageTransition } from "@/lib/motion/page-transition";
import type { ReactNode } from "react";

export default function PageTransitionWrapper({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <AnimatePresence mode="popLayout">
      <motion.div key={pathname} {...pageTransition(reduceMotion)}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
