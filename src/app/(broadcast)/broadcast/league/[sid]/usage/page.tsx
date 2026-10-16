import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import UsageChart from '@/components/broadcast/overlays/UsageChart';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';

interface Props {
  params: Promise<{ sid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Public overlay: /broadcast/league/[sid]/usage?tournament_id=X&round_id=Y&... */
export default async function UsageChartPage({ params, searchParams }: Props) {
  const { sid } = await params;
  const sp = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === 'string') urlParams.set(key, val);
  }
  const config = parseOverlayConfig(urlParams);
  const locale = await resolveOverlayLocale(config, { seasonId: sid });
  const tournamentId = (sp.tournament_id as string) || undefined;
  const roundId = (sp.round_id as string) || undefined;
  const top = sp.top ? parseInt(sp.top as string, 10) : 10;

  return (
    <OverlayShell config={config} locale={locale}>
      <UsageChart
        config={config}
        seasonId={sid}
        tournamentId={tournamentId}
        roundId={roundId}
        top={top}
      />
    </OverlayShell>
  );
}
