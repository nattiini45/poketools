import type { Metadata } from 'next';
import { SpriteStyleProvider } from '@/components/shared/SpriteStyleProvider';
import { NOINDEX } from '@/lib/seo/robots';

/**
 * The root layout paints `bg-page` on <body> (and the site palette script
 * may set a colour on <html>), so an overlay is only see-through if both are
 * overridden. It is a server-rendered <style> rather than a `:has()` rule or a
 * client effect: OBS browser sources older than Chromium 105 have no `:has()`,
 * and the style is in the first HTML so the loading, error and not-found
 * states are transparent too. `!important` beats the palette script's inline style.
 */
export const BROADCAST_TRANSPARENCY_CSS = 'html,body{background:transparent!important}';

export const metadata: Metadata = { robots: NOINDEX };

/**
 * Broadcast overlays are viewerless (an OBS browser source): they render in the
 * site default sprite style whatever `plc_sprite_style` cookie that browser
 * carries (docs/pkmn.md, "Sprite styles"; src/app/AGENTS.md). This provider
 * shadows the root layout's viewer provider for every (broadcast) page.
 */
export default function BroadcastLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SpriteStyleProvider initialPreference="site">
      <style>{BROADCAST_TRANSPARENCY_CSS}</style>
      <div className="min-h-screen bg-transparent">{children}</div>
    </SpriteStyleProvider>
  );
}
