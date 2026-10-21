import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import WeeklyRecap from '@/components/broadcast/overlays/WeeklyRecap';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';

interface Props {
  params: Promise<{ sid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RecapPage({ params, searchParams }: Props) {
  const { sid } = await params;
  const sp = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === 'string') urlParams.set(key, val);
  }
  const config = parseOverlayConfig(urlParams);
  const locale = await resolveOverlayLocale(config, { seasonId: sid });
  const tournamentId = typeof sp.tournament_id === 'string' ? sp.tournament_id : undefined;
  const roundId = typeof sp.round_id === 'string' ? sp.round_id : undefined;

  return (
    <OverlayShell config={config} locale={locale}>
      <WeeklyRecap
        config={config}
        seasonId={sid}
        tournamentId={tournamentId}
        roundId={roundId}
      />
    </OverlayShell>
  );
}
