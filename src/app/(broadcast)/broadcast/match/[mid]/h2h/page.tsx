import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import H2HHistory from '@/components/broadcast/overlays/H2HHistory';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';

interface Props {
  params: Promise<{ mid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Public overlay: /broadcast/match/[mid]/h2h?theme=dark&... */
export default async function H2HHistoryPage({ params, searchParams }: Props) {
  const { mid } = await params;
  const sp = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === 'string') urlParams.set(key, val);
  }
  const config = parseOverlayConfig(urlParams);
  const locale = await resolveOverlayLocale(config, { matchId: mid });

  return (
    <OverlayShell config={config} locale={locale}>
      <H2HHistory config={config} matchId={mid} />
    </OverlayShell>
  );
}
