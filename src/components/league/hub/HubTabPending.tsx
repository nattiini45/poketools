'use client';

import { useLinkStatus } from 'next/link';

/**
 * The pending mark on a hub tab: a tab switch is a server render (the page
 * reads only the selected tab's data), so the clicked tab shows a small pulse
 * until the new view arrives. Must render inside the tab's `<Link>`.
 *
 * The pulse runs only while pending: Tailwind's pulse keyframes animate
 * opacity, so on an idle dot they would override `opacity-0` and every tab
 * would blink.
 */
export default function HubTabPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-pending={pending ? 'true' : undefined}
      className={`ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-arena-accent transition-opacity duration-150 motion-reduce:transition-none ${
        pending ? 'opacity-100 motion-safe:animate-pulse' : 'opacity-0'
      }`}
    />
  );
}
