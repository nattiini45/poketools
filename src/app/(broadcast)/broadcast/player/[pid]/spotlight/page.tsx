import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import PlayerSpotlight from '@/components/broadcast/overlays/PlayerSpotlight';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';

interface Props {
  params: Promise<{ pid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlayerSpotlightPage({ params, searchParams }: Props) {
  const { pid } = await params;
  const sp = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === 'string') urlParams.set(key, val);
  }
  const config = parseOverlayConfig(urlParams);
  const locale = await resolveOverlayLocale(config, {});

  return (
    <OverlayShell config={config} locale={locale}>
      <PlayerSpotlight config={config} playerId={pid} />
    </OverlayShell>
  );
}
