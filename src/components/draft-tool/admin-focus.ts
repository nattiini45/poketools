/**
 * Focus after the room's admin sheet closes (Radix `onCloseAutoFocus`):
 * after "Pick for the active player" the focus goes to the room's admin
 * override switch, which that action just switched on; on any other close
 * Radix returns it to the Admin button as usual.
 */
export function focusAfterAdminSheet(
  event: Pick<Event, 'preventDefault'>,
  pending: { current: boolean },
  overrideSwitch: Pick<HTMLElement, 'focus'> | null,
): void {
  if (!pending.current) return;
  pending.current = false;
  if (!overrideSwitch) return;
  event.preventDefault();
  overrideSwitch.focus();
}
