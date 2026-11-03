"use client";

import { Analytics } from "@vercel/analytics/next";
import { usePathname } from "next/navigation";
import PwaRegistrar from "@/components/shared/PwaRegistrar";
import SitePaletteGuard from "@/components/shared/SitePaletteGuard";

/** True for an overlay URL: `/broadcast` or `/broadcast/...`, not `/broadcasts` or `/dashboard/broadcast`. */
export function isBroadcastPath(pathname: string | null): boolean {
  return pathname === "/broadcast" || (pathname?.startsWith("/broadcast/") ?? false);
}

/**
 * The root layout's page furniture: service worker registration, palette
 * guard and analytics. An OBS browser source is a viewerless embed that must
 * not register a worker, repaint its page with a palette, or report a page
 * view, so all three are skipped under `/broadcast`.
 */
export default function SiteExtras({ analytics }: { analytics: boolean }) {
  const pathname = usePathname();
  if (isBroadcastPath(pathname)) return null;

  return (
    <>
      <PwaRegistrar />
      <SitePaletteGuard />
      {analytics ? <Analytics /> : null}
    </>
  );
}
