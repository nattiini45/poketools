import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import DraftReplayPlayer from '@/components/broadcast/overlays/DraftReplayPlayer';
import { loadDraftOverlayContext, type OverlaySearchParams } from '../overlay-context';

interface Props {
  params: Promise<{ did: string }>;
  searchParams: Promise<OverlaySearchParams>;
}

/** Public overlay: /broadcast/draft/[did]/replay?lang=&... */
export default async function DraftReplayPage({ params, searchParams }: Props) {
  const { did } = await params;
  const sp = await searchParams;
  const { config, locale, lines } = await loadDraftOverlayContext(did, sp);

  return (
    <OverlayShell config={config} locale={locale}>
      <DraftReplayPlayer config={config} draftPoolId={did} lines={lines} />
    </OverlayShell>
  );
}
