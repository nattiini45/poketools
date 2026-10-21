'use client';

import type { BroadcastAnimation } from '@/lib/broadcast/animations';
import { getAnimationStyle } from '@/lib/broadcast/animations';

interface AnimatedRevealProps {
  animation: BroadcastAnimation;
  /** Delay in ms before the animation starts. */
  delay?: number;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Generic entrance animation wrapper for overlay elements.
 * Uses CSS animations (not Framer Motion) for OBS performance.
 */
export default function AnimatedReveal({
  animation,
  delay = 0,
  children,
  className = '',
  style: extraStyle,
}: AnimatedRevealProps) {
  const animStyle = getAnimationStyle(animation, delay);

  return (
    <div className={className} style={{ ...animStyle, ...extraStyle }}>
      {children}
    </div>
  );
}
