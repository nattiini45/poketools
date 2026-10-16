'use client';

import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import ContextOverlay from '@/components/world/ContextOverlay';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { hasOverlayKey } from './overlay-keys';

interface OverlaySwitchProps {
  paramName: string;
  /** Server-rendered overlay bodies keyed by the search-param value that opens them. */
  contents: Record<string, ReactNode>;
  /** Accessible dialog titles keyed by the same values. */
  titles: Record<string, string>;
  /** Accessible close-button label; defaults to ContextOverlay's own. */
  closeLabel?: string;
}

/**
 * Bridges the server-rendered overlay contents to a single ContextOverlay:
 * reads the search param client-side (requires a <Suspense> boundary in the
 * consuming server component — Next.js 16 useSearchParams rule), picks the
 * matching content, and mounts exactly one ContextOverlay whose
 * `triggerValues` prop enumerates the active value. Unknown, absent or
 * prototype-chain values (`constructor`, `toString`, `__proto__` — the param
 * is untrusted URL input) render nothing; membership is own-property only.
 *
 * Route tier docks the overlay beside the focused Subject (ADR-0003); Lite
 * keeps the centered modal.
 *
 * W6: when the param clears on the route tier, the LAST content stays
 * mounted until the docked panel has played its exit to its dock edge
 * (ContextOverlay `onExited`) — unmounting at once would cut the panel out
 * mid-frame. Lite unmounts immediately, as before.
 */
export default function OverlaySwitch({
  paramName,
  contents,
  titles,
  closeLabel,
}: OverlaySwitchProps) {
  const searchParams = useSearchParams();
  const { tier } = useWorldState();
  const value = searchParams.get(paramName);
  const docked = tier === 'route';

  // Own-property check, NOT `value in contents`: the param is URL input, and
  // prototype keys (`constructor`, `toString`, `__proto__`) pass `in` — the
  // "matching" value would be an inherited function, crashing the render
  // (PR #63 review, critical; see overlay-keys.ts).
  const live = value && hasOverlayKey(contents, value) ? value : null;

  // The last live value, kept only for a docked exit. Adjusting state while
  // rendering (React's derived-state pattern) keeps it in step with the
  // param in the same render — no effect lag.
  const [lastLive, setLastLive] = useState<string | null>(live);
  if (live !== null && live !== lastLive) setLastLive(live);
  else if (live === null && !docked && lastLive !== null) setLastLive(null);

  const shown = live ?? (docked ? lastLive : null);
  if (!shown || !hasOverlayKey(contents, shown)) return null;

  return (
    <ContextOverlay
      paramName={paramName}
      triggerValues={live ? [live] : []}
      title={hasOverlayKey(titles, shown) ? titles[shown] : ''}
      docked={docked}
      closeLabel={closeLabel}
      onExited={() => setLastLive(null)}
    >
      {contents[shown]}
    </ContextOverlay>
  );
}
