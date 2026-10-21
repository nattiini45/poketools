import { SpriteStyleProvider } from '@/components/shared/SpriteStyleProvider';

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
      <div className="min-h-screen bg-transparent">{children}</div>
    </SpriteStyleProvider>
  );
}
