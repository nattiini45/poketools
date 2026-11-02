"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useInView, useReducedMotion } from "@/components/shared/motion";

const noopSubscribe = () => () => {};
const isClient = () => true;
const isServer = () => false;

interface CountUpNumberProps {
  value: number;
  duration?: number;
  className?: string;
}

export default function CountUpNumber({
  value,
  duration = 400,
  className,
}: CountUpNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);
  // false while hydrating, so the first client render matches the server's 0 even when the viewer prefers reduced motion.
  const hydrated = useSyncExternalStore(noopSubscribe, isClient, isServer);

  useEffect(() => {
    if (reduceMotion || !inView || value === 0) return;

    const start = performance.now();
    let raf: number;

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));

      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion, inView, value, duration]);

  const renderedValue = (reduceMotion && hydrated) || (inView && value === 0) ? value : display;

  return (
    <span ref={ref} className={className}>
      {renderedValue}
    </span>
  );
}
