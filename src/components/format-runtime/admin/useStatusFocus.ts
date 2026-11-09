'use client';

import { useCallback, useRef } from 'react';

/**
 * Where keyboard focus goes after a control of the Live tab did its work and is gone, or disabled, as a result (a button
 * replaced by a badge, a row that left the list, a Lock button the refreshed page disables): the island's `role="status"`
 * line, made focusable with `tabIndex={-1}`. Without it focus falls to `<body>` and the keyboard user starts again at the
 * top of the long tab.
 *
 * - `focusNow()` for a plain button (no dialog).
 * - `focusOnClose()` after a dialog's confirm succeeded, with `onCloseAutoFocus` on the dialog. The dialogs are opened
 *   without a Radix trigger, so Radix has nothing to give focus back to and drops it to `<body>`; the flag makes the
 *   dialog hand it to the status line instead. A dialog that closes without it (Cancel, a failure) behaves as before.
 */
export function useStatusFocus() {
  const statusRef = useRef<HTMLDivElement>(null);
  const afterClose = useRef(false);

  const focusNow = useCallback(() => statusRef.current?.focus(), []);
  const focusOnClose = useCallback(() => {
    afterClose.current = true;
  }, []);
  const onCloseAutoFocus = useCallback((event: Event) => {
    if (!afterClose.current) return;
    afterClose.current = false;
    event.preventDefault();
    statusRef.current?.focus();
  }, []);

  return { statusRef, focusNow, focusOnClose, onCloseAutoFocus };
}
