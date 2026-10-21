import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import MatchResults from '@/components/broadcast/overlays/MatchResults';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';

interface Props {
  params: Promise<{ mid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Public overlay: /broadcast/match/[mid]/results?theme=dark&... */
export default async function MatchResultsPage({ params, searchParams }: Props) {
  const { mid } = await params;
  const sp = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, val] of Object.entries(sp)) {
    if (typeof val === 'string') urlParams.set(key, val);
  }
  const config = parseOverlayConfig(urlParams);
  const locale = await resolveOverlayLocale(config, { matchId: mid });

  const spoiler = sp.spoiler === 'true';
  const showMVP = sp.showMVP !== 'false';

  return (
    <OverlayShell config={config} locale={locale}>
      <MatchResults
        config={config}
        matchId={mid}
        spoiler={spoiler}
        showMVP={showMVP}
      />
    </OverlayShell>
  );
}
