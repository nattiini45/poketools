import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import DraftPickReveal from '@/components/broadcast/overlays/DraftPickReveal';
import { loadDraftOverlayContext, type OverlaySearchParams } from '../overlay-context';

interface Props {
  params: Promise<{ did: string }>;
  searchParams: Promise<OverlaySearchParams>;
}

/**
 * Public overlay: /broadcast/draft/[did]/pick?lang=&autoAdvance=&...
 * A legacy `pickRevealDuration` param in saved OBS URLs is tolerated and ignored (the reveal holds the
 * newest pick until the next one arrives).
 */
export default async function DraftPickRevealPage({ params, searchParams }: Props) {
  const { did } = await params;
  const sp = await searchParams;
  const { config, locale, lines } = await loadDraftOverlayContext(did, sp, { poll: '3000' });

  return (
    <OverlayShell config={config} locale={locale}>
      <DraftPickReveal config={config} draftPoolId={did} lines={lines} autoAdvance={sp.autoAdvance !== 'false'} />
    </OverlayShell>
  );
}
