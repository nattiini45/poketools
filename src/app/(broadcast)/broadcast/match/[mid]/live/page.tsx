import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import LiveStatBar from '@/components/broadcast/overlays/LiveStatBar';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';

interface Props {
  params: Promise<{ mid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Public overlay: /broadcast/match/[mid]/live?theme=dark&poll=3000&... */
export default async function LiveStatBarPage({ params, searchParams }: Props) {
  const { mid } = await params;
  const sp = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === 'string') urlParams.set(key, val);
  }
  // Default shorter poll interval for live stat bar
  if (!sp.poll) urlParams.set('poll', '3000');
  const config = parseOverlayConfig(urlParams);
  const locale = await resolveOverlayLocale(config, { matchId: mid });

  return (
    <OverlayShell config={config} locale={locale} height={120}>
      <LiveStatBar config={config} matchId={mid} />
    </OverlayShell>
  );
}
