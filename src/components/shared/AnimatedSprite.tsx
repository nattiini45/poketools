"use client";

import { useRef } from "react";
import { motion, useInView } from "@/components/shared/motion";
import type { ReactNode } from "react";

interface AnimatedSpriteProps {
  children: ReactNode;
  delay?: number;
}

export default function AnimatedSprite({ children, delay = 0 }: AnimatedSpriteProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <motion.div
      ref={ref}
      initial={{ scale: 0, opacity: 0 }}
      animate={inView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
      transition={{
        type: "spring",
        damping: 15,
        stiffness: 300,
        delay,
      }}
      style={{ display: "inline-flex" }}
    >
      {children}
    </motion.div>
  );
}
