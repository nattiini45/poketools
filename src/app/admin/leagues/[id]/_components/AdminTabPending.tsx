'use client';

import { useLinkStatus } from 'next/link';

/**
 * The pending mark on a league admin tab: a tab switch is a server render (the
 * page reads only the selected tab's data), so the clicked tab shows a small
 * dot until the new view arrives. Must render inside the tab's `<Link>`.
 *
 * The dot pulses only while pending and only when the viewer allows motion
 * (`motion-safe:`); otherwise it just appears. Theme tokens, no fixed colour.
 */
export default function AdminTabPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-pending={pending ? 'true' : undefined}
      className={`ml-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-poke-accent motion-safe:transition-opacity motion-safe:duration-150 ${
        pending ? 'opacity-100 motion-safe:animate-pulse' : 'opacity-0'
      }`}
    />
  );
}
