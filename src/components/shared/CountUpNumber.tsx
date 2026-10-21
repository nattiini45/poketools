"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/components/shared/motion";

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
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView || value === 0) return;

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
  }, [inView, value, duration]);

  const renderedValue = inView && value === 0 ? 0 : display;

  return (
    <span ref={ref} className={className}>
      {renderedValue}
    </span>
  );
}
