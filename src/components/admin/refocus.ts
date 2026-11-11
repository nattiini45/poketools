/**
 * Gives keyboard focus back to the control that opened an overlay (the command menu, the phone drawer) once the
 * overlay has let go of it. The overlay releases focus when its exit finishes, so this looks a few times; it never
 * takes focus from an element that already has it (a followed link, the assistant drawer).
 */
export function refocusWhenReleased(target: HTMLElement | null): () => void {
  if (!target) return () => {};
  const timers = [0, 150, 400].map((delay) =>
    window.setTimeout(() => {
      if (target.isConnected && (document.activeElement === null || document.activeElement === document.body)) target.focus();
    }, delay),
  );
  return () => timers.forEach((timer) => window.clearTimeout(timer));
}
