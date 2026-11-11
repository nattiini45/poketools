"use client";

import { usePathname } from "next/navigation";
import type { ReactNode, Ref } from "react";
import { motion, AnimatePresence, useIsPresent, useReducedMotion } from "@/components/shared/motion";
import { pageTransition } from "@/lib/motion/page-transition";

/**
 * One route's page. While the route is leaving (the exit tween of `AnimatePresence`) the arriving page is already
 * mounted beside it, so the leaving copy is taken out of the accessibility tree and the tab order: two headings
 * and two sets of controls would otherwise exist for about 140 ms. Nothing here changes how the copy is drawn.
 * `ref` is forwarded because `popLayout` measures the direct child's element.
 */
function PageSlot({
  children,
  reduceMotion,
  ref,
}: {
  children: ReactNode;
  reduceMotion: boolean;
  ref?: Ref<HTMLDivElement>;
}) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      ref={ref}
      suppressHydrationWarning
      inert={!isPresent}
      aria-hidden={isPresent ? undefined : true}
      {...pageTransition(reduceMotion)}
    >
      {children}
    </motion.div>
  );
}

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
      <PageSlot key={pathname} reduceMotion={reduceMotion}>
        {children}
      </PageSlot>
    </AnimatePresence>
  );
}
