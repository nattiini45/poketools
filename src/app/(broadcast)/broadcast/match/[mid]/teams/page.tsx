import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import TeamComparison from '@/components/broadcast/overlays/TeamComparison';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';

interface Props {
  params: Promise<{ mid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Public overlay: /broadcast/match/[mid]/teams?theme=dark&... */
export default async function TeamComparisonPage({ params, searchParams }: Props) {
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
      <TeamComparison config={config} matchId={mid} />
    </OverlayShell>
  );
}
