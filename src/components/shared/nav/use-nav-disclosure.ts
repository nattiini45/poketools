'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * A disclosure panel inside `#site-nav` (More, the account menu). Never portalled and not a Radix popover: the
 * panel must stay a DOM descendant of the bar, so the D33 reveal over the 3D world keeps the bar open while the
 * pointer or focus is in the panel, and the bar's `backdrop-filter` would break a fixed-position popper anyway.
 *
 * The panel belongs to the page it was opened on: the open state records that pathname, so a soft navigation
 * closes it with no effect, and the first render on another pathname drops the record, so a Back/Forward round
 * trip never re-opens it.
 */
export function useNavDisclosure() {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<{ path: string | null } | null>(null);
  if (openOn !== null && openOn.path !== pathname) setOpenOn(null);
  const open = openOn !== null && openOn.path === pathname;
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    // Native listener on the wrapper, not React's onKeyDown: the App Router's React root is `document`, the node
    // RouteNavReveal listens on. The Escape that closes this panel must stop here, or it would also close the
    // revealed bar over the 3D world and move focus out of the nav (D33).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpenOn(null);
      triggerRef.current?.focus();
    };
    // Tab out of the panel closes it without moving focus. A null relatedTarget (a press on non-focusable
    // panel space) is not "out".
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !wrapper.contains(next)) setOpenOn(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapper.contains(event.target)) return;
      setOpenOn(null);
    };
    wrapper.addEventListener('keydown', onKeyDown);
    wrapper.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      wrapper.removeEventListener('keydown', onKeyDown);
      wrapper.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  return {
    open,
    setOpen: (next: boolean) => setOpenOn(next ? { path: pathname } : null),
    panelId,
    wrapperRef,
    triggerRef,
  };
}
