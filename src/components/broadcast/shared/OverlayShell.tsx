import type { OverlayConfig } from '@/types/broadcast';
import { getOverlayStyle } from '@/lib/broadcast/overlay-config';
import { BROADCAST_KEYFRAMES } from '@/lib/broadcast/animations';
import { overlayI18nProps } from '@/lib/broadcast/overlay-locale';
import { I18nProvider } from '@/i18n/client';
import type { Locale } from '@/i18n/config';

interface OverlayShellProps {
  config: OverlayConfig;
  children: React.ReactNode;
  /** Override viewport dimensions (e.g., for lower-third: 1920×120). */
  height?: number;
  /**
   * The overlay language from `resolveOverlayLocale` (i18n-core §6.5). When
   * set, the shell marks its root with `lang` and wraps the overlay in a nested
   * `I18nProvider` (UI and Pokémon terms in this language, league time zone),
   * so the viewer cookie read by the root layout never reaches the overlay.
   */
  locale?: Locale;
}

/**
 * Root wrapper for all broadcast overlay pages.
 *
 * Sets viewport dimensions, injects CSS custom properties for theming,
 * loads animation keyframes, and provides a transparent background
 * suitable for OBS browser sources.
 *
 * Transparency guarantee: `<html>` and `<body>` are transparent on every
 * overlay URL, with no caster CSS. The shell only styles its own box; the page
 * background comes from the `(broadcast)` layout's server-rendered
 * `html,body{background:transparent!important}` rule (no `:has()`, so old OBS
 * builds work), and `loading.tsx`, `error.tsx` and `not-found.tsx` in that
 * group render nothing so no state shows a site card.
 *
 * OBS compatibility:
 * - Transparent background (no chroma key needed)
 * - Fixed viewport (no responsive breakpoints)
 * - No scrollbars
 * - System fonts (no FOUT from external font loading)
 */
export default function OverlayShell({ config, children, height, locale }: OverlayShellProps) {
  const style = getOverlayStyle(config);
  const viewportH = height ?? config.h;

  return (
    <div
      data-frozen="broadcast"
      lang={locale}
      style={{
        ...style,
        width: `${config.w}px`,
        height: `${viewportH}px`,
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: 'var(--broadcast-text)',
        position: 'relative',
      }}
    >
      {/* Inject keyframes — server-rendered, no FOUC */}
      <style dangerouslySetInnerHTML={{ __html: BROADCAST_KEYFRAMES }} />
      {locale ? <I18nProvider {...overlayI18nProps(locale)}>{children}</I18nProvider> : children}
    </div>
  );
}
