'use client';

import { useState, useEffect } from 'react';

interface OverlayTimerProps {
  mode: 'countdown' | 'elapsed';
  /** For countdown: target time. For elapsed: start time. */
  targetTime: Date;
  /** Called when countdown reaches zero. */
  onComplete?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Countdown or elapsed timer for broadcast overlays.
 * Updates every second via requestAnimationFrame.
 */
export default function OverlayTimer({
  mode,
  targetTime,
  onComplete,
  className = '',
  style,
}: OverlayTimerProps) {
  const [display, setDisplay] = useState('0:00');

  useEffect(() => {
    let frameId: number;
    let completeFired = false;

    function tick() {
      const now = Date.now();
      const target = targetTime.getTime();

      let diffMs: number;
      if (mode === 'countdown') {
        diffMs = Math.max(0, target - now);
        if (diffMs === 0 && !completeFired) {
          completeFired = true;
          onComplete?.();
        }
      } else {
        diffMs = Math.max(0, now - target);
      }

      const totalSeconds = Math.floor(diffMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      setDisplay(`${minutes}:${seconds.toString().padStart(2, '0')}`);

      frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [mode, targetTime, onComplete]);

  return (
    <span
      className={className}
      style={{
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 600,
        color: 'var(--broadcast-text)',
        ...style,
      }}
    >
      {display}
    </span>
  );
}
