import { DURATION, EASE, OFFSET } from './tokens';

/**
 * The route-change cross-fade. Under reduced motion only the opacity moves (docs/design.md, "Motion"): content stays
 * legible and the change stays visible, without vertical travel.
 */
export function pageTransition(reduceMotion: boolean) {
  return {
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: OFFSET.sm },
    animate: reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 },
    exit: reduceMotion ? { opacity: 0 } : { opacity: 0, y: -OFFSET.sm / 2 },
    transition: { duration: DURATION.micro, ease: EASE.out },
  };
}
