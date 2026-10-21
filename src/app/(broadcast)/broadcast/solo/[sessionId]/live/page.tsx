import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';
import SoloLiveFacing from '@/components/broadcast/overlays/SoloLiveFacing';

interface Props {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

/** Public overlay: /broadcast/solo/[sessionId]/live?theme=dark&poll=3000&... */
export default async function SoloLiveFacingPage({ params, searchParams }: Props) {
  const { sessionId } = await params;
  const sp = await searchParams;
  const urlParams = new URLSearchParams(
    Object.entries(sp).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  const config = parseOverlayConfig(urlParams);
  const locale = await resolveOverlayLocale(config, {});
  const pollInterval = sp.poll ? Math.max(1000, Math.min(60000, parseInt(sp.poll, 10))) : 3000;

  return (
    <OverlayShell config={config} locale={locale} height={120}>
      <SoloLiveFacing sessionId={sessionId} pollInterval={pollInterval} />
    </OverlayShell>
  );
}
