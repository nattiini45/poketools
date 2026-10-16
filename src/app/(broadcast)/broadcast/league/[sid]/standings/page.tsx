import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import StandingsTicker from '@/components/broadcast/overlays/StandingsTicker';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';

interface Props {
  params: Promise<{ sid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Public overlay: /broadcast/league/[sid]/standings?layout=full&... */
export default async function StandingsPage({ params, searchParams }: Props) {
  const { sid } = await params;
  const sp = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === 'string') urlParams.set(key, val);
  }
  const config = parseOverlayConfig(urlParams);
  const locale = await resolveOverlayLocale(config, { seasonId: sid });

  const layout = (sp.layout as 'full' | 'ticker') || 'full';
  const top = sp.top ? parseInt(sp.top as string, 10) : 0;
  const highlight = (sp.highlight as string) || undefined;
  const scrollSpeed = (sp.scrollSpeed as 'slow' | 'normal' | 'fast') || 'normal';

  return (
    <OverlayShell config={config} locale={locale} height={layout === 'ticker' ? 60 : undefined}>
      <StandingsTicker
        config={config}
        seasonId={sid}
        layout={layout}
        top={top}
        highlight={highlight}
        scrollSpeed={scrollSpeed}
      />
    </OverlayShell>
  );
}
