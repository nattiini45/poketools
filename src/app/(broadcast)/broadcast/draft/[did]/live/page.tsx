import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import DraftViewer from '@/components/broadcast/overlays/DraftViewer';
import { loadDraftOverlayContext, type OverlaySearchParams } from '../overlay-context';

interface Props {
  params: Promise<{ did: string }>;
  searchParams: Promise<OverlaySearchParams>;
}

/** Public overlay: /broadcast/draft/[did]/live?lang=&showBudget=&showTiers=&... */
export default async function DraftViewerPage({ params, searchParams }: Props) {
  const { did } = await params;
  const sp = await searchParams;
  const { config, locale, lines } = await loadDraftOverlayContext(did, sp, { poll: '3000' });

  return (
    <OverlayShell config={config} locale={locale}>
      <DraftViewer
        config={config}
        draftPoolId={did}
        lines={lines}
        showBudget={sp.showBudget !== 'false'}
        showTiers={sp.showTiers !== 'false'}
      />
    </OverlayShell>
  );
}
