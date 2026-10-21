'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useWorldState } from './WorldStateProvider';
import { getSceneProgress, getServerSceneProgress, subscribeSceneProgress } from './scene-progress';
import {
  getThemeVeilPhase,
  getThemeVeilTarget,
  getThemeVeilTrace,
  subscribeThemeVeil,
  type ThemeVeilTraceEntry,
} from './theme-veil-store';
import { useLocale } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { loaderStageLine } from '@/lib/route-world/ball-loader-state';
import { themeVeilCopy, type ThemeVeilPhase } from '@/lib/route-world/theme-veil';

type VeilHost = Window & {
  /** `?routeDebug=1` / `?routeTrace=1`: the veil's phase, target and time-stamped log. */
  __routeThemeVeil?: () => { phase: ThemeVeilPhase; target: 'day' | 'night' | null; trace: ThemeVeilTraceEntry[] };
};

const getIdle = () => 'idle' as const;

/** The progress line under the title — mounted only while the veil holds (load-rate store). */
function VeilProgress({ locale }: { locale: Locale }) {
  const progress = useSyncExternalStore(subscribeSceneProgress, getSceneProgress, getServerSceneProgress);
  return <span className="route-theme-veil-progress">{loaderStageLine(locale, progress)}</span>;
}

/**
 * D32 — the theme veil layer: a full-viewport sheet in the page background
 * colour (`--world-ground`, the world's own theme token — never a fixed dark
 * slab, D25) that covers the canvas (it follows the canvas wrapper in DOM
 * order at the same z-index, so the HUD, the Station Card, the panels and the
 * site NavBar all stay above it). Its opacity is driven by
 * `<html data-route-veil>` alone (globals.css, D32 block): compositor fades,
 * instant under reduced motion. While it holds, a quiet status line names
 * the swap and the load progress; the polite live region carries the same
 * words for screen readers. Mounted with the route canvas only (never Lite).
 */
export default function RouteThemeVeil() {
  const { debug } = useWorldState();
  const phase = useSyncExternalStore(subscribeThemeVeil, getThemeVeilPhase, getIdle);
  const active = phase !== 'idle';
  const target = active ? getThemeVeilTarget() : null;
  // i18n D11: the veil speaks the viewer's language, never the theme's.
  const locale = useLocale();
  const title = target ? themeVeilCopy(locale)[target] : '';

  useEffect(() => {
    const traceOn = debug || new URLSearchParams(window.location.search).get('routeTrace') === '1';
    if (!traceOn) return;
    const host = window as VeilHost;
    host.__routeThemeVeil = () => ({ phase: getThemeVeilPhase(), target: getThemeVeilTarget(), trace: getThemeVeilTrace() });
    return () => {
      delete host.__routeThemeVeil;
    };
  }, [debug]);

  return (
    <>
      <div aria-hidden="true" data-route-veil-layer="" className="route-theme-veil">
        {active && phase !== 'out' && title !== '' ? (
          <p className="route-theme-veil-status">
            {/* ENGINE-FIX (D32): once the opaque hold passes ~600 ms, a small
                Pokéball (the loader's ball, drawn on no chip — D25) rocks
                above the line so the pause reads as intentional. */}
            <span aria-hidden="true" className="route-theme-veil-ball">
              <span className="route-theme-veil-ball-button" />
            </span>
            <span className="route-theme-veil-title">{title}</span>
            <VeilProgress locale={locale} />
          </p>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {active && phase !== 'out' ? title : ''}
      </p>
    </>
  );
}
