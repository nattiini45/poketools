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
    // `initial={false}`: the server cannot know the reduced-motion preference, so the first paint must not carry the
    // slide's starting offset (a reduced-motion client would never animate it away and keep the page shifted).
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div key={pathname} suppressHydrationWarning {...pageTransition(reduceMotion)}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
