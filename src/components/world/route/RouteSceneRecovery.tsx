'use client';

import { useLocale } from '@/i18n/client';
import { useWorldState } from './WorldStateProvider';
import { isRetryableLiteReason } from '@/lib/route-world/quality';
import { themeLoaderCopy } from '@/components/world/themes/station-copy';

/**
 * The manual retry offered after a RECOVERABLE scene failure (context loss,
 * scene error, readiness timeout).
 *
 * Deliberately absent for capability-based Lite — a visitor on a data-saver,
 * reduced motion, low-memory device or without WebGL cannot retry their way
 * into the route tier, so showing them a button that cannot work is noise.
 * The bounded-retry rule (D1/D2) is one explicit user action, never an
 * automatic reload loop.
 *
 * Copy follows the viewer's language (i18n D11: `world-themes.loader` through
 * `themeLoaderCopy(useLocale())`; a theme carries no language of its own). A
 * one-line reason says why the page is the plain version, so the retry is not
 * a mystery button.
 */
export default function RouteSceneRecovery() {
  const { liteReason, retryRouteScene } = useWorldState();
  const locale = useLocale();

  if (!isRetryableLiteReason(liteReason)) return null;

  const copy = themeLoaderCopy(locale);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-poke-md border border-poke-border bg-poke-card py-1.5 pl-3 pr-1.5 shadow-lg">
      <p id="route-scene-recovery-reason" className="text-xs text-poke-text-secondary">
        {copy.failed}
      </p>
      <button
        type="button"
        onClick={retryRouteScene}
        aria-describedby="route-scene-recovery-reason"
        className="shrink-0 rounded-poke-md border border-poke-border bg-poke-card px-3 py-2 font-heading text-xs font-semibold text-poke-text-primary transition-colors hover:bg-poke-hover focus:border-poke-focus focus:outline-none focus:ring-1 focus:ring-poke-focus"
      >
        {copy.retry}
      </button>
    </div>
  );
}
