import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import MatchPreview from '@/components/broadcast/overlays/MatchPreview';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';

interface Props {
  params: Promise<{ mid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Public overlay: /broadcast/match/[mid]/preview?theme=dark&... */
export default async function MatchPreviewPage({ params, searchParams }: Props) {
  const { mid } = await params;
  const sp = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === 'string') urlParams.set(key, val);
  }
  const config = parseOverlayConfig(urlParams);
  const locale = await resolveOverlayLocale(config, { matchId: mid });

  const showH2H = sp.showH2H !== 'false';
  const showSig = sp.showSig !== 'false';
  const duration = sp.duration ? parseInt(sp.duration as string, 10) : 0;

  return (
    <OverlayShell config={config} locale={locale}>
      <MatchPreview
        config={config}
        matchId={mid}
        showH2H={showH2H}
        showSig={showSig}
        duration={duration}
      />
    </OverlayShell>
  );
}
