'use client';

/**
 * Hover intent for the roster wall's hover details (draft-frontend §5.1,
 * SPEC:383). `onHover(value)` arms a timer; the value becomes `intent` only
 * after `delayMs` without leaving. `onHover(null)` clears at once.
 *
 * This is the only hover delay of the draft screen: `HoverDetails` shows
 * whatever line it is given. Touch devices are filtered upstream
 * (`RosterWall` only reports mouse hover and keyboard focus).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HOVER_DELAY_MS } from '@/lib/draft-ui/constants';

export function useHoverIntent<T>(delayMs: number = HOVER_DELAY_MS): {
  intent: T | null;
  onHover(value: T | null): void;
} {
  const [intent, setIntent] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const onHover = useCallback(
    (value: T | null) => {
      clear();
      if (value === null) {
        setIntent(null);
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        setIntent(value);
      }, Math.max(0, delayMs));
    },
    [delayMs, clear],
  );

  return { intent, onHover };
}
