import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';
import SoloTeamPreview from '@/components/broadcast/overlays/SoloTeamPreview';

interface Props {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

/** Public overlay: /broadcast/solo/[sessionId]/team-preview?theme=dark&poll=5000&... */
export default async function SoloTeamPreviewPage({ params, searchParams }: Props) {
  const { sessionId } = await params;
  const sp = await searchParams;
  const urlParams = new URLSearchParams(
    Object.entries(sp).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  const config = parseOverlayConfig(urlParams);
  const locale = await resolveOverlayLocale(config, {});
  const pollInterval = sp.poll ? Math.max(1000, Math.min(60000, parseInt(sp.poll, 10))) : 5000;

  return (
    <OverlayShell config={config} locale={locale}>
      <SoloTeamPreview sessionId={sessionId} pollInterval={pollInterval} />
    </OverlayShell>
  );
}
