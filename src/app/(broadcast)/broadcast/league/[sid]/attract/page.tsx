import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import LeagueAttractScreen from '@/components/broadcast/overlays/LeagueAttractScreen';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';

interface Props {
  params: Promise<{ sid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Public overlay: /broadcast/league/[sid]/attract?cardDuration=12000&... */
export default async function AttractPage({ params, searchParams }: Props) {
  const { sid } = await params;
  const sp = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === 'string') urlParams.set(key, val);
  }
  const config = parseOverlayConfig(urlParams);
  const locale = await resolveOverlayLocale(config, { seasonId: sid });

  const cardDuration = sp.cardDuration ? parseInt(sp.cardDuration as string, 10) : 12000;
  const transition = (sp.transition as 'fade' | 'slide' | 'none') || 'fade';

  return (
    <OverlayShell config={config} locale={locale}>
      <LeagueAttractScreen
        config={config}
        seasonId={sid}
        cardDuration={cardDuration}
        transition={transition}
      />
    </OverlayShell>
  );
}
